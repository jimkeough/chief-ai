import { createHash, createHmac, timingSafeEqual } from "node:crypto";
import { classifyEvent } from "@/lib/events";
import { appSettingsFromRows } from "@/lib/settings";
import { createAdminClient } from "@/lib/supabase/admin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX_BODY_BYTES = 1_000_000;
const MAX_SIGNATURE_AGE_SECONDS = 300;
const CLASSIFICATION_TIMEOUT_MS = 8_000;

function validSignature(
  signingKey: string | null,
  signatureHeader: string | null,
  rawBody: string,
): boolean {
  if (!signingKey || !signatureHeader) return false;
  const fields = Object.fromEntries(
    signatureHeader.split(",").map((part) => {
      const [key, ...value] = part.trim().split("=");
      return [key, value.join("=")];
    }),
  );
  const timestamp = fields.t;
  const received = fields.v1?.toLowerCase();
  if (!/^\d+$/.test(timestamp ?? "") || !/^[a-f0-9]{64}$/.test(received ?? "")) {
    return false;
  }
  const age = Math.abs(Math.floor(Date.now() / 1000) - Number(timestamp));
  if (!Number.isFinite(age) || age > MAX_SIGNATURE_AGE_SECONDS) return false;

  const expected = createHmac("sha256", signingKey)
    .update(`${timestamp}.${rawBody}`)
    .digest("hex");
  const expectedBytes = Buffer.from(expected, "hex");
  const receivedBytes = Buffer.from(received, "hex");
  return (
    expectedBytes.length === receivedBytes.length &&
    timingSafeEqual(expectedBytes, receivedBytes)
  );
}

export async function POST(request: Request) {
  const token = new URL(request.url).searchParams.get("t")?.trim() ?? "";
  if (!/^[a-f0-9]{48}$/.test(token)) {
    return new Response("Missing or invalid token.", { status: 400 });
  }
  const contentLength = Number(request.headers.get("content-length") ?? 0);
  if (contentLength > MAX_BODY_BYTES) {
    return new Response("Payload too large.", { status: 413 });
  }
  const raw = await request.text();
  if (Buffer.byteLength(raw, "utf8") > MAX_BODY_BYTES) {
    return new Response("Payload too large.", { status: 413 });
  }

  let admin;
  try {
    admin = createAdminClient();
  } catch {
    return new Response("Proactive events are not configured.", { status: 503 });
  }
  const { data: trigger, error: triggerError } = await admin
    .from("chief_triggers")
    .select("id,user_id,app,signing_key")
    .eq("token", token)
    .maybeSingle();
  if (triggerError) {
    console.error("chief_triggers lookup failed:", triggerError.message);
    return new Response("Trigger lookup failed.", { status: 500 });
  }
  if (!trigger) return new Response("Unknown trigger.", { status: 404 });

  if (
    !validSignature(
      (trigger.signing_key as string | null) ?? null,
      request.headers.get("x-pd-signature"),
      raw,
    )
  ) {
    return new Response("Bad signature.", { status: 401 });
  }

  let body: unknown;
  try {
    body = raw ? JSON.parse(raw) : {};
  } catch {
    return new Response("Invalid JSON.", { status: 400 });
  }
  const record =
    body && typeof body === "object" ? (body as Record<string, unknown>) : {};
  const nestedEvent =
    record.event && typeof record.event === "object"
      ? (record.event as Record<string, unknown>)
      : {};
  const candidateId =
    request.headers.get("x-pd-event-id") ?? record.id ?? nestedEvent.id;
  const eventId =
    typeof candidateId === "string" && candidateId.trim()
      ? candidateId.trim().slice(0, 500)
      : `sha256:${createHash("sha256").update(raw).digest("hex")}`;
  const userId = trigger.user_id as string;
  const app = (trigger.app as string) || "";

  const fallbackSummary = `New activity in ${app || "a connected app"}.`;
  const { data: inserted, error: insertError } = await admin
    .from("chief_events")
    .insert({
      user_id: userId,
      trigger_id: trigger.id,
      app,
      external_event_id: eventId,
      summary: fallbackSummary,
      proposal: null,
      status: "new",
    })
    .select("id")
    .single();
  if (insertError?.code === "23505") {
    return new Response("ok (duplicate)", { status: 200 });
  }
  if (insertError || !inserted) {
    console.error("chief_events insert failed:", insertError?.message ?? "No row returned.");
    return new Response("Event insert failed.", { status: 500 });
  }

  const { data: settingRows, error: settingsError } = await admin
    .from("settings")
    .select("key,value")
    .eq("user_id", userId);
  if (settingsError) {
    console.error("Event settings lookup failed:", settingsError.message);
  }
  const settings = appSettingsFromRows(
    ((settingRows ?? []) as Array<{ key: string; value: string }>),
  );
  const classified = await Promise.race([
    classifyEvent(app, body, settings).catch(() => null),
    new Promise<null>((resolve) =>
      setTimeout(() => resolve(null), CLASSIFICATION_TIMEOUT_MS),
    ),
  ]);
  if (classified) {
    const { error: updateError } = await admin
      .from("chief_events")
      .update({
        summary: classified.summary,
        proposal: classified.proposal,
      })
      .eq("id", inserted.id)
      .eq("user_id", userId);
    if (updateError) {
      console.error("chief_events classification update failed:", updateError.message);
    }
  }
  return new Response("ok", { status: 200 });
}

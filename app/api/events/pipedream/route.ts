// POST /api/events/pipedream?t=<token> — the ingest endpoint for Proactive
// Chief. Pipedream POSTs a deployed trigger's events here. There is NO user
// session; the request is authenticated by the unguessable per-trigger token
// in the URL (shared only with Pipedream at deploy time), verified against the
// chief_triggers registry, with Pipedream's HMAC signature checked on top when
// a signing key is present. Writes go through the service-role client, scoped
// to the trigger's owner.
//
// Each event becomes a chief_events row (dedup on Pipedream's event id): an
// inbound email/message also lands in communications so the waiting-on strip
// turns green in real time; anything Chief deems actionable carries a proposal
// that surfaces on Home and runs through the normal executor gate on approval.
// Nothing here ever auto-acts.

import { createHmac, timingSafeEqual } from "node:crypto";
import { createAdminClient } from "@/lib/supabase/admin";
import { classifyEvent } from "@/lib/events";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Best-effort HMAC-SHA256 verification of Pipedream's delivery signature. When
// no signing key is stored, or no signature header is sent, we fall back to the
// token guard alone (the token is itself a shared secret). A PRESENT signature
// that doesn't match is rejected.
function signatureOk(
  signingKey: string | null,
  signature: string | null,
  rawBody: string,
): boolean {
  if (!signingKey || !signature) return true;
  try {
    const expected = createHmac("sha256", signingKey)
      .update(rawBody)
      .digest("hex");
    const a = Buffer.from(expected);
    const b = Buffer.from(signature.replace(/^sha256=/, ""));
    return a.length === b.length && timingSafeEqual(a, b);
  } catch {
    return false;
  }
}

export async function POST(req: Request) {
  const token = new URL(req.url).searchParams.get("t")?.trim();
  if (!token) return new Response("Missing token.", { status: 400 });

  const raw = await req.text();

  const admin = createAdminClient();
  const { data: trigger } = await admin
    .from("chief_triggers")
    .select("id, user_id, app, signing_key")
    .eq("token", token)
    .maybeSingle();
  if (!trigger) return new Response("Unknown trigger.", { status: 404 });

  const signature =
    req.headers.get("x-pd-signature") ?? req.headers.get("x-signature");
  if (!signatureOk(trigger.signing_key, signature, raw)) {
    return new Response("Bad signature.", { status: 401 });
  }

  let body: unknown = {};
  try {
    body = raw ? JSON.parse(raw) : {};
  } catch {
    /* keep {} */
  }

  // Pipedream's event id, if present, for idempotent redelivery.
  const eventId =
    (body as { id?: string })?.id ??
    req.headers.get("x-pd-event-id") ??
    null;

  const userId = trigger.user_id as string;
  const app = (trigger.app as string) ?? "";

  // Already recorded? (Redelivery.) The unique index also guards the race.
  if (eventId) {
    const { data: existing } = await admin
      .from("chief_events")
      .select("id")
      .eq("user_id", userId)
      .eq("external_event_id", eventId)
      .maybeSingle();
    if (existing) return new Response("ok (dup)", { status: 200 });
  }

  const classified = await classifyEvent(app, body).catch(() => null);
  const summary = classified?.summary ?? `New activity in ${app || "a connected app"}.`;
  const proposal = classified?.proposal ?? null;

  const { error } = await admin.from("chief_events").insert({
    user_id: userId,
    trigger_id: trigger.id,
    app,
    external_event_id: eventId,
    summary,
    proposal,
    status: "new",
  });
  // A unique-violation is a race with a concurrent redelivery — treat as ok.
  if (error && !/duplicate key/i.test(error.message)) {
    console.error("chief_events insert failed:", error.message);
    return new Response("insert failed", { status: 500 });
  }

  return new Response("ok", { status: 200 });
}

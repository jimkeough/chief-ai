// Trigger management for the Config UI (session-authed). GET ?app= lists an
// app's deployable trigger components + the user's already-deployed triggers;
// POST deploys one (registers it with a fresh token + signing key); DELETE
// removes one (Pipedream + local registry).

import { getAuthed, unauthorized } from "@/lib/auth";
import { randomBytes } from "node:crypto";
import {
  listTriggerComponents,
  deployTrigger,
  deleteConnectTrigger,
} from "@/lib/chief-connect";
import { listTriggers, saveTrigger, deleteTriggerRow } from "@/lib/events";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  if (!(await getAuthed())) return unauthorized();
  const app = new URL(req.url).searchParams.get("app")?.trim() ?? "";
  try {
    const [components, deployed] = await Promise.all([
      app ? listTriggerComponents(app) : Promise.resolve([]),
      listTriggers(),
    ]);
    return Response.json({
      ok: true,
      components,
      deployed: deployed
        .filter((t) => !app || t.app === app)
        .map((t) => ({ id: t.id, app: t.app, componentId: t.component_id, name: t.name })),
    });
  } catch (e) {
    const error = e instanceof Error ? e.message : "Failed.";
    return Response.json({ ok: false, error }, { status: 502 });
  }
}

export async function POST(req: Request) {
  const authed = await getAuthed();
  if (!authed) return unauthorized();
  const { app, componentId, name } = (await req.json().catch(() => ({}))) as {
    app?: string;
    componentId?: string;
    name?: string;
  };
  if (!app?.trim() || !componentId?.trim()) {
    return Response.json({ ok: false, error: "app and componentId required" }, { status: 400 });
  }
  try {
    const token = randomBytes(24).toString("hex");
    const origin = new URL(req.url).origin;
    const webhookUrl = `${origin}/api/events/pipedream?t=${token}`;
    const deployed = await deployTrigger({ id: componentId.trim(), webhookUrl });
    await saveTrigger(authed.userId, {
      id: deployed.id,
      app: app.trim(),
      componentId: componentId.trim(),
      name: name?.trim() || deployed.name || null,
      token,
      signingKey: deployed.signingKey,
    });
    return Response.json({ ok: true, id: deployed.id });
  } catch (e) {
    const error = e instanceof Error ? e.message : "Deploy failed.";
    return Response.json({ ok: false, error }, { status: 502 });
  }
}

export async function DELETE(req: Request) {
  if (!(await getAuthed())) return unauthorized();
  const id = new URL(req.url).searchParams.get("id")?.trim();
  if (!id) return Response.json({ ok: false, error: "id required" }, { status: 400 });
  try {
    await deleteConnectTrigger(id).catch(() => {}); // best-effort at Pipedream
    await deleteTriggerRow(id);
    return Response.json({ ok: true });
  } catch (e) {
    const error = e instanceof Error ? e.message : "Delete failed.";
    return Response.json({ ok: false, error }, { status: 502 });
  }
}

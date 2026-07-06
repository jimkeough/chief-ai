// POST /api/connect/link { app? } — a hosted Connect Link for the managed
// OAuth flow; the client opens it in a new tab.

import { getAuthed, unauthorized } from "@/lib/auth";
import { getConnectLink } from "@/lib/chief-connect";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  if (!(await getAuthed())) return unauthorized();
  const { app } = (await req.json().catch(() => ({}))) as { app?: string };
  try {
    const url = await getConnectLink(app?.trim() || undefined);
    return Response.json({ ok: true, url });
  } catch (e) {
    const error = e instanceof Error ? e.message : "Connect link failed.";
    return Response.json({ ok: false, error }, { status: 502 });
  }
}

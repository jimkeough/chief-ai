// GET /api/connect/apps?q= — search the connector catalog by name.
// POST /api/connect/apps { slug } — enable an app (adds it to connect.apps)
// and return a Connect Link to authorize it immediately.

import { getAuthed, unauthorized } from "@/lib/auth";
import {
  searchConnectApps,
  addConnectApp,
  getConnectLink,
} from "@/lib/chief-connect";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  if (!(await getAuthed())) return unauthorized();
  const q = new URL(req.url).searchParams.get("q") ?? "";
  try {
    return Response.json({ ok: true, apps: await searchConnectApps(q) });
  } catch (e) {
    const error = e instanceof Error ? e.message : "Search failed.";
    return Response.json({ ok: false, error }, { status: 502 });
  }
}

export async function POST(req: Request) {
  const authed = await getAuthed();
  if (!authed) return unauthorized();
  const { slug } = (await req.json().catch(() => ({}))) as { slug?: string };
  if (!slug?.trim()) {
    return Response.json({ ok: false, error: "slug required" }, { status: 400 });
  }
  try {
    await addConnectApp(authed.userId, slug);
    const url = await getConnectLink(slug.trim().toLowerCase());
    return Response.json({ ok: true, url });
  } catch (e) {
    const error = e instanceof Error ? e.message : "Couldn't enable the app.";
    return Response.json({ ok: false, error }, { status: 502 });
  }
}

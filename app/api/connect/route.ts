// GET /api/connect — Chief Connect status for the Config page: whether the
// layer is configured, the enabled app slugs, and connected accounts.

import { getAuthed, unauthorized } from "@/lib/auth";
import { getConnectConfig, listConnectAccounts } from "@/lib/chief-connect";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  if (!(await getAuthed())) return unauthorized();
  const config = await getConnectConfig();
  if (!config) return Response.json({ configured: false });
  try {
    const accounts = await listConnectAccounts(config);
    return Response.json({ configured: true, apps: config.apps, accounts });
  } catch (e) {
    const error = e instanceof Error ? e.message : "Chief Connect unreachable.";
    return Response.json({ configured: true, apps: config.apps, error });
  }
}

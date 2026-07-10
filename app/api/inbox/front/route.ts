// GET /api/inbox/front — the open conversations in the user's connected Front
// account, read through the MCP broker (see lib/front-inbox.ts). Read-only and
// fails soft: returns { connected: false } when Front isn't wired up, so the
// Inbox screen simply omits the Front section.

import { getAuthed, unauthorized } from "@/lib/auth";
import { listOpenFrontConversations } from "@/lib/front-inbox";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function GET() {
  if (!(await getAuthed())) return unauthorized();
  const result = await listOpenFrontConversations();
  const status = "error" in result && result.connected ? 502 : 200;
  return Response.json(result, { status });
}

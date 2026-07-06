// GET /api/events/list — pending proactive proposals/summaries for Home + the
// Chief bar count.
import { getAuthed, unauthorized } from "@/lib/auth";
import { listPendingEvents } from "@/lib/events";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  if (!(await getAuthed())) return unauthorized();
  try {
    const events = await listPendingEvents();
    return Response.json({ ok: true, events });
  } catch (e) {
    const error = e instanceof Error ? e.message : "Failed.";
    return Response.json({ ok: false, error }, { status: 502 });
  }
}

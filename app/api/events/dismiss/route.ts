// POST /api/events/dismiss { id, status } — mark a proactive event acted or
// dismissed so it leaves the pending queue.
import { getAuthed, unauthorized } from "@/lib/auth";
import { setEventStatus } from "@/lib/events";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  if (!(await getAuthed())) return unauthorized();
  const { id, status } = (await req.json().catch(() => ({}))) as {
    id?: string;
    status?: "acted" | "dismissed";
  };
  if (!id || (status !== "acted" && status !== "dismissed")) {
    return Response.json({ ok: false, error: "id and status required" }, { status: 400 });
  }
  try {
    await setEventStatus(id, status);
    return Response.json({ ok: true });
  } catch (e) {
    const error = e instanceof Error ? e.message : "Failed.";
    return Response.json({ ok: false, error }, { status: 502 });
  }
}

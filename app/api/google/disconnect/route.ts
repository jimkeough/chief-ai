// Disconnect Gmail: revoke the grant at Google (best-effort) and delete the
// stored tokens. Plain POST from the Inbox/Config UI.

import { getAuthed, unauthorized } from "@/lib/auth";
import { disconnectGoogle } from "@/lib/google-auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST() {
  if (!(await getAuthed())) return unauthorized();
  try {
    await disconnectGoogle();
    return Response.json({ ok: true });
  } catch (e) {
    const error = e instanceof Error ? e.message : "Disconnect failed.";
    return Response.json({ ok: false, error }, { status: 500 });
  }
}

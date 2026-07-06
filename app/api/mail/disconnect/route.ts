// POST /api/mail/disconnect — remove the stored app-password mail account.
// (The user should also revoke the app password at their provider; the UI
// says so.)

import { getAuthed, unauthorized } from "@/lib/auth";
import { deleteMailAccount } from "@/lib/mail";
import { createJournalEntry } from "@/lib/journal";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST() {
  if (!(await getAuthed())) return unauthorized();
  try {
    await deleteMailAccount();
    await createJournalEntry({
      title: "Disconnected mail account",
      metadata: { via: "imap" },
    }).catch(() => {});
    return Response.json({ ok: true });
  } catch (e) {
    const error = e instanceof Error ? e.message : "Disconnect failed.";
    return Response.json({ ok: false, error }, { status: 500 });
  }
}

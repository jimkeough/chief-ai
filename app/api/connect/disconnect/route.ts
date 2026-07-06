// POST /api/connect/disconnect { accountId } — remove one connected account
// (the service verifies ownership before deleting).

import { getAuthed, unauthorized } from "@/lib/auth";
import { disconnectConnectAccount } from "@/lib/chief-connect";
import { createJournalEntry } from "@/lib/journal";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  if (!(await getAuthed())) return unauthorized();
  const { accountId } = (await req.json().catch(() => ({}))) as {
    accountId?: string;
  };
  if (!accountId?.trim()) {
    return Response.json({ ok: false, error: "accountId required" }, { status: 400 });
  }
  try {
    await disconnectConnectAccount(accountId.trim());
    await createJournalEntry({
      title: "Disconnected connector",
      note: accountId,
      metadata: { via: "chief-connect" },
    }).catch(() => {});
    return Response.json({ ok: true });
  } catch (e) {
    const error = e instanceof Error ? e.message : "Disconnect failed.";
    return Response.json({ ok: false, error }, { status: 502 });
  }
}

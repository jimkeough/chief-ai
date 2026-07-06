// POST /api/mail/connect — save the app-password (IMAP/SMTP) mail account.
// The credential is VERIFIED live (IMAP login + INBOX open) before anything
// is stored, so a typo'd password fails here with a clear message instead of
// breaking the inbox later. Stored only in the user's own database (RLS).

import { getAuthed, unauthorized } from "@/lib/auth";
import { saveMailAccount, verifyMailAccount, type MailAccount } from "@/lib/mail";
import { createJournalEntry } from "@/lib/journal";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function POST(req: Request) {
  if (!(await getAuthed())) return unauthorized();

  const body = (await req.json().catch(() => ({}))) as Partial<MailAccount>;
  const email = String(body.email ?? "").trim().toLowerCase();
  const password = String(body.password ?? "").replace(/\s+/g, ""); // Google shows app passwords with spaces
  if (!email || !email.includes("@") || !password) {
    return Response.json(
      { ok: false, error: "An email address and app password are required." },
      { status: 400 },
    );
  }

  const account: MailAccount = {
    email,
    password,
    imap_host: String(body.imap_host ?? "").trim() || "imap.gmail.com",
    imap_port: Number(body.imap_port) || 993,
    smtp_host: String(body.smtp_host ?? "").trim() || "smtp.gmail.com",
    smtp_port: Number(body.smtp_port) || 465,
  };

  try {
    await verifyMailAccount(account);
  } catch (e) {
    const detail = e instanceof Error ? e.message : "login failed";
    return Response.json(
      {
        ok: false,
        error: `Couldn't sign in to ${account.imap_host}: ${detail}. Check the address and app password (and that IMAP is enabled for the account).`,
      },
      { status: 400 },
    );
  }

  await saveMailAccount(account);
  await createJournalEntry({
    title: "Connected mail account",
    note: email,
    metadata: { via: "imap" },
  }).catch(() => {});
  return Response.json({ ok: true, account: email });
}

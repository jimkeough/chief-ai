// The mail provider abstraction. Chief's inbox has two transports:
//
//  - "imap": the app-password path (imapflow + nodemailer) — one string to
//    set up, works with any provider (Gmail, Outlook, Fastmail, …). The
//    credential is a full-mailbox app password stored only in the user's own
//    database (mail_accounts).
//  - "gmail-mcp": the Google OAuth path (lib/gmail.ts) — scoped grant through
//    Google's official Gmail MCP server, for users who did the OAuth-client
//    setup.
//
// The IMAP account wins when both are configured (it's the one the user set
// up deliberately as their daily driver). Everything above this module —
// the inbox API, the executor, the undo route — talks to the provider
// interface, so the write gate is identical either way: archive is a
// standard card, send is the slide-to-send card, and the executor stays the
// only write path.

import { createClient } from "@/lib/supabase/server";
import {
  gmailMcpServer,
  getInboxSnapshot as gmailInboxSnapshot,
  archiveThread as gmailArchive,
  unarchiveThread as gmailUnarchive,
  sendGmailReply,
  type InboxSnapshot,
} from "@/lib/gmail";
import type { UndoDescriptor } from "@/lib/undo";

export type { InboxEmail, InboxSnapshot } from "@/lib/gmail";

export type MailAccount = {
  email: string;
  password: string;
  imap_host: string;
  imap_port: number;
  smtp_host: string;
  smtp_port: number;
};

export type SendInput = {
  /** The provider's thread handle: Gmail thread id, or IMAP uid. */
  threadId: string;
  to: string[];
  cc?: string[];
  subject: string;
  body: string;
};

export type MailProvider = {
  kind: "imap" | "gmail-mcp";
  /** The connected address, for display. */
  account: string | null;
  getInboxSnapshot(): Promise<InboxSnapshot>;
  /** Archive; returns the undo descriptor (or null when not undoable). */
  archive(threadId: string, subject?: string): Promise<UndoDescriptor | null>;
  send(input: SendInput): Promise<void>;
};

// --- Account storage ---------------------------------------------------------

const ACCOUNT_COLUMNS =
  "email, password, imap_host, imap_port, smtp_host, smtp_port";

export async function getMailAccount(): Promise<MailAccount | null> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("mail_accounts")
    .select(ACCOUNT_COLUMNS)
    .maybeSingle();
  if (error) throw new Error(error.message);
  return (data as MailAccount | null) ?? null;
}

export async function saveMailAccount(account: MailAccount): Promise<void> {
  const supabase = await createClient();
  const { error } = await supabase
    .from("mail_accounts")
    .upsert(account, { onConflict: "user_id" });
  if (error) throw new Error(error.message);
}

export async function deleteMailAccount(): Promise<void> {
  const supabase = await createClient();
  const { error } = await supabase
    .from("mail_accounts")
    .delete()
    .gte("created_at", "1970-01-01");
  if (error) throw new Error(error.message);
}

// --- IMAP / SMTP implementation ----------------------------------------------

// Gmail-shaped servers archive by moving to All Mail; everything else gets a
// plain "Archive" mailbox (created on first use).
function archiveMailbox(account: MailAccount): string {
  return account.imap_host.includes("gmail") ? "[Gmail]/All Mail" : "Archive";
}

async function withImap<T>(
  account: MailAccount,
  fn: (client: import("imapflow").ImapFlow) => Promise<T>,
): Promise<T> {
  const { ImapFlow } = await import("imapflow");
  const client = new ImapFlow({
    host: account.imap_host,
    port: account.imap_port,
    secure: true,
    auth: { user: account.email, pass: account.password },
    logger: false,
    socketTimeout: 30_000,
    greetingTimeout: 15_000,
  });
  await client.connect();
  try {
    return await fn(client);
  } finally {
    await client.logout().catch(() => {});
  }
}

/** Quick credential check used by the connect endpoint: can we log in to IMAP
 *  and open INBOX? (SMTP shares the same credential on every mainstream
 *  provider, so one probe is enough to validate the password.) */
export async function verifyMailAccount(account: MailAccount): Promise<void> {
  await withImap(account, async (client) => {
    const lock = await client.getMailboxLock("INBOX");
    lock.release();
  });
}

async function imapInboxSnapshot(account: MailAccount): Promise<InboxSnapshot> {
  const { simpleParser } = await import("mailparser");
  return withImap(account, async (client) => {
    const lock = await client.getMailboxLock("INBOX");
    try {
      const mailbox = client.mailbox;
      const total = mailbox && typeof mailbox === "object" ? mailbox.exists : 0;
      if (!total) return { email: null, queueCount: 0 };

      // Newest message in INBOX (sequence "*"), full source → parsed.
      const msg = await client.fetchOne("*", { source: true, uid: true });
      if (!msg || !msg.source) return { email: null, queueCount: total };
      const parsed = await simpleParser(msg.source);

      const fromAddr = parsed.from?.value?.[0];
      const from = fromAddr
        ? fromAddr.name
          ? `${fromAddr.name} <${fromAddr.address ?? ""}>`
          : (fromAddr.address ?? "(unknown sender)")
        : "(unknown sender)";
      const toList = parsed.to
        ? (Array.isArray(parsed.to) ? parsed.to : [parsed.to]).flatMap((t) =>
            t.value.map((v) => v.address ?? "").filter(Boolean),
          )
        : [];
      const bodyText = (parsed.text ?? "").trim();

      return {
        email: {
          threadId: String(msg.uid),
          messageId: parsed.messageId ?? null,
          from,
          to: toList,
          subject: parsed.subject ?? "(no subject)",
          date: parsed.date?.toISOString() ?? null,
          snippet: bodyText.slice(0, 200),
          body: bodyText,
          messageCount: 1,
        },
        queueCount: total,
      };
    } finally {
      lock.release();
    }
  });
}

async function imapArchive(
  account: MailAccount,
  uid: string,
  subject?: string,
): Promise<UndoDescriptor | null> {
  const dest = archiveMailbox(account);
  return withImap(account, async (client) => {
    const lock = await client.getMailboxLock("INBOX");
    try {
      // Ensure the destination exists on non-Gmail servers (no-op if present).
      if (dest === "Archive") {
        await client.mailboxCreate(dest).catch(() => {});
      }
      const res = await client.messageMove(uid, dest, { uid: true });
      // uidMap gives the message's uid in the destination mailbox — that's
      // what undo needs to move it back.
      const map =
        res && typeof res === "object" && "uidMap" in res
          ? (res.uidMap as Map<number, number> | undefined)
          : undefined;
      const newUid = map?.get(Number(uid));
      if (!newUid) return null;
      return {
        kind: "unarchive_imap",
        uid: String(newUid),
        mailbox: dest,
        label: `Back in inbox${subject ? `: ${subject}` : ""}`,
      };
    } finally {
      lock.release();
    }
  });
}

/** Undo of an IMAP archive: move the message back from the archive mailbox. */
export async function imapUnarchive(
  account: MailAccount,
  uid: string,
  mailbox: string,
): Promise<void> {
  await withImap(account, async (client) => {
    const lock = await client.getMailboxLock(mailbox);
    try {
      await client.messageMove(uid, "INBOX", { uid: true });
    } finally {
      lock.release();
    }
  });
}

async function imapSend(account: MailAccount, input: SendInput): Promise<void> {
  // Look up the original Message-ID by uid so the reply threads properly.
  let inReplyTo: string | undefined;
  await withImap(account, async (client) => {
    const lock = await client.getMailboxLock("INBOX");
    try {
      const msg = await client
        .fetchOne(input.threadId, { envelope: true, uid: true }, { uid: true })
        .catch(() => null);
      // imapflow types fetchOne as FetchMessageObject | false.
      inReplyTo = (msg ? msg.envelope?.messageId : undefined) || undefined;
    } finally {
      lock.release();
    }
  }).catch(() => {});

  const nodemailer = (await import("nodemailer")).default;
  const transport = nodemailer.createTransport({
    host: account.smtp_host,
    port: account.smtp_port,
    secure: account.smtp_port === 465,
    auth: { user: account.email, pass: account.password },
  });
  await transport.sendMail({
    from: account.email,
    to: input.to.join(", "),
    ...(input.cc?.length ? { cc: input.cc.join(", ") } : {}),
    subject: input.subject,
    text: input.body,
    ...(inReplyTo ? { inReplyTo, references: inReplyTo } : {}),
  });
}

// --- Provider resolution -------------------------------------------------------

/** The active mail provider: the IMAP account when one is saved, else the
 *  Google OAuth connection, else null (not connected). */
export async function getMailProvider(): Promise<MailProvider | null> {
  const account = await getMailAccount().catch(() => null);
  if (account) {
    return {
      kind: "imap",
      account: account.email,
      getInboxSnapshot: () => imapInboxSnapshot(account),
      archive: (threadId, subject) => imapArchive(account, threadId, subject),
      send: (input) => imapSend(account, input),
    };
  }

  const server = await gmailMcpServer().catch(() => null);
  if (server) {
    return {
      kind: "gmail-mcp",
      account: null,
      getInboxSnapshot: () => gmailInboxSnapshot(server),
      archive: async (threadId, subject) => {
        await gmailArchive(server, threadId);
        return {
          kind: "unarchive_thread",
          thread_id: threadId,
          label: `Back in inbox${subject ? `: ${subject}` : ""}`,
        };
      },
      send: async (input) => {
        await sendGmailReply({
          threadId: input.threadId,
          to: input.to,
          cc: input.cc,
          subject: input.subject,
          body: input.body,
        });
      },
    };
  }

  return null;
}

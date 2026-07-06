// GET /api/inbox — the V1 inbox: the newest message still in the inbox + the
// queue count, read through the active mail provider (app-password IMAP, or
// the Gmail OAuth path). Each new inbound message is recorded once in the
// append-only communications log (attributed to a saved contact when the
// sender matches), which is what the waiting-on cross-reference reads.

import { getAuthed, unauthorized } from "@/lib/auth";
import { googleOauthConfigured } from "@/lib/google-auth";
import { getMailProvider } from "@/lib/mail";
import { getContactByEmail } from "@/lib/contacts";
import {
  hasEmailCommunication,
  recordCommunication,
} from "@/lib/communications";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

// Pull a bare address out of "Name <a@b.com>" or pass a plain address through.
function bareAddress(from: string): string {
  const m = from.match(/<([^>]+)>/);
  return (m ? m[1] : from).trim().toLowerCase();
}

export async function GET() {
  if (!(await getAuthed())) return unauthorized();

  const provider = await getMailProvider().catch(() => null);
  if (!provider) {
    // Not connected: the UI offers the app-password form always, and the
    // OAuth button only when the deployment has a Google client configured.
    return Response.json({
      connected: false,
      oauthConfigured: googleOauthConfigured(),
    });
  }

  try {
    const snapshot = await provider.getInboxSnapshot();

    let contact: { id: string; name: string } | null = null;
    if (snapshot.email) {
      const sender = bareAddress(snapshot.email.from);
      const match = await getContactByEmail(sender).catch(() => null);
      if (match) contact = { id: match.id, name: match.name };

      // Log the inbound once (append-only; keyed by the message id).
      const messageId = snapshot.email.messageId;
      if (messageId && !(await hasEmailCommunication(messageId).catch(() => true))) {
        await recordCommunication({
          channel: "email",
          direction: "in",
          contactId: contact?.id ?? null,
          externalThreadId: snapshot.email.threadId,
          subject: snapshot.email.subject,
          // Store the snippet, not the full body (plain, durable, small).
          bodyText: snapshot.email.snippet,
          occurredAt: snapshot.email.date ?? undefined,
          metadata: { gmail_message_id: messageId, from: sender },
        }).catch(() => {});
      }
    }

    return Response.json({
      connected: true,
      provider: provider.kind,
      account: provider.account,
      email: snapshot.email,
      queueCount: snapshot.queueCount,
      contact,
    });
  } catch (e) {
    const error = e instanceof Error ? e.message : "Inbox fetch failed.";
    return Response.json({ connected: true, error }, { status: 502 });
  }
}

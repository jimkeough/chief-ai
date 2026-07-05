// GET /api/inbox — the V1 inbox: the newest thread still in the inbox + the
// queue count, read through the official Gmail MCP server with the user's own
// grant. Each new inbound message is recorded once in the append-only
// communications log (attributed to a saved contact when the sender matches),
// which is what the waiting-on cross-reference reads.

import { getAuthed, unauthorized } from "@/lib/auth";
import { googleOauthConfigured, getGoogleConnection } from "@/lib/google-auth";
import { gmailMcpServer, getInboxSnapshot } from "@/lib/gmail";
import { getContactByEmail } from "@/lib/contacts";
import {
  hasEmailCommunication,
  recordCommunication,
} from "@/lib/communications";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Pull a bare address out of "Name <a@b.com>" or pass a plain address through.
function bareAddress(from: string): string {
  const m = from.match(/<([^>]+)>/);
  return (m ? m[1] : from).trim().toLowerCase();
}

export async function GET() {
  if (!(await getAuthed())) return unauthorized();

  const configured = googleOauthConfigured();
  const connection = configured ? await getGoogleConnection() : null;
  if (!configured || !connection) {
    return Response.json({ configured, connected: false });
  }

  try {
    const server = await gmailMcpServer();
    if (!server) return Response.json({ configured, connected: false });
    const snapshot = await getInboxSnapshot(server);

    let contact: { id: string; name: string } | null = null;
    if (snapshot.email) {
      const sender = bareAddress(snapshot.email.from);
      const match = await getContactByEmail(sender).catch(() => null);
      if (match) contact = { id: match.id, name: match.name };

      // Log the inbound once (append-only; keyed by the Gmail message id).
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
      configured,
      connected: true,
      account: connection.email,
      email: snapshot.email,
      queueCount: snapshot.queueCount,
      contact,
    });
  } catch (e) {
    const error = e instanceof Error ? e.message : "Inbox fetch failed.";
    return Response.json(
      { configured, connected: true, error },
      { status: 502 },
    );
  }
}

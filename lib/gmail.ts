// The Gmail adapter — a thin layer over Google's OFFICIAL hosted Gmail MCP
// server (https://gmailmcp.googleapis.com/mcp/v1), reached through the same
// broker as every other connector, using the user's own OAuth grant
// (lib/google-auth.ts) as the bearer token.
//
// The official server can read (search_threads / get_thread — annotated
// readOnlyHint, so the broker runs them transparently), draft, and label; it
// deliberately CANNOT send. The one send in this app is sendGmailReply below —
// a single Gmail REST call the EXECUTOR makes only after the user approves the
// red-tier reply proposal via slide-to-send. Nothing else in the app can send
// email.

import type { McpServerConfig } from "@/lib/mcp";
import { callMcpTool } from "@/lib/mcp-broker";
import { getGoogleAccessToken } from "@/lib/google-auth";

export const GMAIL_MCP_URL = "https://gmailmcp.googleapis.com/mcp/v1";

/** Broker config for the official Gmail MCP server, or null when Gmail isn't
 *  connected. Built fresh per request so the bearer token is always current. */
export async function gmailMcpServer(): Promise<McpServerConfig | null> {
  const token = await getGoogleAccessToken();
  if (!token) return null;
  return {
    name: "gmail",
    app: "gmail",
    url: GMAIL_MCP_URL,
    authorization_token: token,
  };
}

// Call one Gmail MCP tool and parse its JSON text result.
async function callGmail<T>(
  server: McpServerConfig,
  tool: string,
  args: Record<string, unknown>,
): Promise<T> {
  const text = await callMcpTool(server, tool, args);
  try {
    return JSON.parse(text) as T;
  } catch {
    throw new Error(`Gmail returned an unexpected response for ${tool}.`);
  }
}

// Shapes observed live from the official server (camelCase). Fields we don't
// use are omitted; parsing is tolerant of absences.
type GmailMessage = {
  id?: string;
  date?: string;
  sender?: string;
  toRecipients?: string[];
  ccRecipients?: string[];
  subject?: string;
  snippet?: string;
  plaintextBody?: string;
  labelIds?: string[];
};
type GmailThread = { id?: string; messages?: GmailMessage[] };
type SearchThreadsResponse = {
  threads?: GmailThread[];
  resultCountEstimate?: string | number;
};
type GetThreadResponse = { id?: string; messages?: GmailMessage[] } & {
  thread?: GmailThread;
};

export type InboxEmail = {
  threadId: string;
  messageId: string | null;
  from: string;
  to: string[];
  subject: string;
  date: string | null;
  snippet: string;
  /** Plain-text body of the newest message (clipped by the caller as needed). */
  body: string;
  /** How many messages the thread carries. */
  messageCount: number;
};

export type InboxSnapshot = {
  /** Newest open (in-inbox) email, or null when the inbox is empty. */
  email: InboxEmail | null;
  /** Approximate number of threads still in the inbox. */
  queueCount: number;
};

/** V1 inbox: the single newest thread still in the inbox + the queue count. */
export async function getInboxSnapshot(
  server: McpServerConfig,
): Promise<InboxSnapshot> {
  const search = await callGmail<SearchThreadsResponse>(server, "search_threads", {
    query: "in:inbox",
    pageSize: 1,
    view: "THREAD_VIEW_MINIMAL",
  });
  const queueCount = Number(search.resultCountEstimate ?? 0) || 0;
  const threadId = search.threads?.[0]?.id;
  if (!threadId) return { email: null, queueCount };

  const full = await callGmail<GetThreadResponse>(server, "get_thread", {
    threadId,
    messageFormat: "FULL_CONTENT",
  });
  const messages = full.messages ?? full.thread?.messages ?? [];
  if (messages.length === 0) return { email: null, queueCount };
  const latest = messages[messages.length - 1];

  return {
    email: {
      threadId,
      messageId: latest.id ?? null,
      from: latest.sender ?? "(unknown sender)",
      to: latest.toRecipients ?? [],
      subject: latest.subject ?? "(no subject)",
      date: latest.date ?? null,
      snippet: latest.snippet ?? "",
      body: (latest.plaintextBody ?? latest.snippet ?? "").trim(),
      messageCount: messages.length,
    },
    queueCount,
  };
}

/** Archive = remove the INBOX label from the thread (reversible). */
export async function archiveThread(
  server: McpServerConfig,
  threadId: string,
): Promise<void> {
  await callMcpTool(server, "unlabel_thread", {
    threadId,
    labelIds: ["INBOX"],
  });
}

/** Undo of archive: put the INBOX label back. */
export async function unarchiveThread(
  server: McpServerConfig,
  threadId: string,
): Promise<void> {
  await callMcpTool(server, "label_thread", {
    threadId,
    labelIds: ["INBOX"],
  });
}

// --- The ONE send path -------------------------------------------------------
// Direct Gmail REST call (the official MCP server has no send tool). Runs only
// inside /api/actions/execute after an approved red-tier proposal. Threading is
// preserved by passing threadId; Gmail groups the reply into the conversation.

function toBase64Url(input: string): string {
  return Buffer.from(input, "utf8")
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

// RFC 2047 encoding for non-ASCII subjects.
function encodeHeader(value: string): string {
  return /^[\x20-\x7e]*$/.test(value)
    ? value
    : `=?UTF-8?B?${Buffer.from(value, "utf8").toString("base64")}?=`;
}

export async function sendGmailReply(input: {
  threadId: string;
  to: string[];
  cc?: string[];
  subject: string;
  body: string;
}): Promise<{ id: string }> {
  const token = await getGoogleAccessToken();
  if (!token) throw new Error("Gmail is not connected.");
  if (input.to.length === 0) throw new Error("The reply has no recipients.");

  const headers = [
    `To: ${input.to.join(", ")}`,
    ...(input.cc?.length ? [`Cc: ${input.cc.join(", ")}`] : []),
    `Subject: ${encodeHeader(input.subject)}`,
    'Content-Type: text/plain; charset="UTF-8"',
    "Content-Transfer-Encoding: 8bit",
    "MIME-Version: 1.0",
  ];
  const raw = toBase64Url(`${headers.join("\r\n")}\r\n\r\n${input.body}`);

  const res = await fetch(
    "https://gmail.googleapis.com/gmail/v1/users/me/messages/send",
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ raw, threadId: input.threadId }),
    },
  );
  if (!res.ok) {
    const detail = await res.text();
    throw new Error(`Gmail send failed (${res.status}): ${detail.slice(0, 300)}`);
  }
  const data = (await res.json()) as { id?: string };
  return { id: data.id ?? "" };
}

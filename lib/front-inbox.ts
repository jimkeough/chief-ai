// Front inbox source — lists the OPEN conversations from a connected Front
// account and surfaces them on the Inbox screen, alongside (and independent of)
// the IMAP/Gmail email triage.
//
// Front is reached the same way every other connector is: through the MCP
// broker (lib/mcp-broker.ts). Front can be wired up either by hand (a
// `mcp.servers` entry, typically named "frontapp") or through Chief Connect's
// Pipedream integration (a "pipedream-front"/"pipedream-frontapp" server). We
// look in both places, find whichever server is Front, list its tools, call its
// "list conversations" tool, and map the result into a small, UI-friendly shape.
//
// Everything here is read-only and fails soft: a missing/misbehaving Front
// connection returns "not connected" or an error string, never throws, so the
// email inbox keeps working regardless.

import { getMcpServers, type McpServerConfig } from "@/lib/mcp";
import { getConnectServers } from "@/lib/chief-connect";
import { listMcpTools, callMcpTool } from "@/lib/mcp-broker";

export type FrontConversation = {
  id: string;
  subject: string;
  /** Raw Front status/category, lower-cased (e.g. "unassigned", "open"). */
  status: string;
  /** One-line preview of the latest message. */
  preview: string;
  /** Who the conversation is with (recipient name/handle, best effort). */
  correspondent: string;
  /** ISO timestamp of the last activity, or null. */
  updatedAt: string | null;
  tags: string[];
  /** Best-effort link back to Front (API self link), or null. */
  link: string | null;
};

export type FrontInboxResult =
  | { connected: false }
  | { connected: true; account?: string | null; conversations: FrontConversation[] }
  | { connected: true; error: string };

const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, "");

/** True when a broker server looks like a Front connector. */
function isFrontServer(s: McpServerConfig): boolean {
  const hay = `${norm(s.app ?? "")} ${norm(s.name ?? "")}`;
  return hay.includes("front");
}

/** Find the Front broker server across manual mcp.servers + Chief Connect. */
export async function resolveFrontServer(): Promise<McpServerConfig | null> {
  const manual = await getMcpServers().catch(() => []);
  const fromManual = manual.find(isFrontServer);
  if (fromManual) return fromManual;
  const connect = await getConnectServers().catch(() => []);
  return connect.find(isFrontServer) ?? null;
}

/** Choose the tool that lists conversations, tolerant of naming differences
 *  across Front MCP implementations (Pipedream exposes `list-conversations`;
 *  others use `list_conversations`, `list_inbox_conversations`, etc.). */
function pickListTool(tools: { name: string }[]): string | null {
  const scored = tools
    .map((t) => {
      const n = norm(t.name);
      const hasConv = n.includes("conversation");
      if (!hasConv) return { name: t.name, score: 0 };
      let score = 0;
      if (n.includes("list")) score += 3;
      if (n.includes("listconversations")) score += 3;
      if (n.includes("inbox")) score += 1;
      if (n.includes("search")) score += 1; // acceptable fallback
      if (n.includes("message")) score -= 2; // "list conversation messages" is not it
      if (n.includes("tagged") || n.includes("contact")) score -= 1;
      return { name: t.name, score };
    })
    .filter((x) => x.score > 0)
    .sort((a, b) => b.score - a.score);
  return scored[0]?.name ?? null;
}

/** Convert Front's epoch-seconds (float) — or an already-ISO string — to ISO. */
function toIso(v: unknown): string | null {
  if (typeof v === "string") {
    const asNum = Number(v);
    if (Number.isFinite(asNum) && v.trim() !== "") return toIso(asNum);
    const d = new Date(v);
    return Number.isNaN(d.getTime()) ? null : d.toISOString();
  }
  if (typeof v === "number" && Number.isFinite(v)) {
    // Front uses seconds; anything below ~10^12 is seconds, not millis.
    const ms = v < 1e12 ? v * 1000 : v;
    const d = new Date(ms);
    return Number.isNaN(d.getTime()) ? null : d.toISOString();
  }
  return null;
}

type Rec = Record<string, unknown>;
const isRec = (v: unknown): v is Rec => !!v && typeof v === "object" && !Array.isArray(v);
const str = (v: unknown): string => (typeof v === "string" ? v : "");

/** Pull the conversation array out of whatever shape the tool returned: a bare
 *  array, Front's `_results`, or a wrapper object. Falls back to the first
 *  array-of-objects found anywhere in the payload. */
function extractConversations(parsed: unknown): Rec[] {
  if (Array.isArray(parsed)) return parsed.filter(isRec);
  if (isRec(parsed)) {
    for (const key of ["_results", "conversations", "results", "data", "items", "ret"]) {
      const v = parsed[key];
      if (Array.isArray(v)) return v.filter(isRec);
      if (isRec(v)) {
        const nested = extractConversations(v);
        if (nested.length) return nested;
      }
    }
    // Last resort: first array-of-objects anywhere in the object.
    for (const v of Object.values(parsed)) {
      if (Array.isArray(v) && v.some(isRec)) return v.filter(isRec);
    }
  }
  return [];
}

function isOpen(o: Rec): boolean {
  const cat = str(o.status_category).toLowerCase();
  if (cat) return cat === "open";
  const st = str(o.status).toLowerCase();
  if (st) return st === "assigned" || st === "unassigned" || st === "open";
  return true; // no status info → assume it's a live conversation
}

function correspondentOf(o: Rec): string {
  const recipient = isRec(o.recipient) ? o.recipient : null;
  if (recipient) {
    const n = str(recipient.name).trim();
    const h = str(recipient.handle).trim();
    if (n || h) return n || h;
  }
  const last = isRec(o.last_message) ? o.last_message : null;
  const author = last && isRec(last.author) ? last.author : null;
  if (author) {
    const n = `${str(author.first_name)} ${str(author.last_name)}`.trim();
    const h = str(author.handle).trim();
    if (n || h) return n || h;
  }
  return "";
}

function mapConversation(o: Rec): FrontConversation | null {
  const id = str(o.id);
  if (!id) return null;
  const last = isRec(o.last_message) ? o.last_message : null;
  const preview =
    str(last?.blurb) || str(last?.body) || str(o.blurb) || str(o.subject);
  const links = isRec(o._links) ? o._links : null;
  const tags = Array.isArray(o.tags)
    ? o.tags
        .map((t) => (isRec(t) ? str(t.name) : typeof t === "string" ? t : ""))
        .filter(Boolean)
    : [];
  return {
    id,
    subject: str(o.subject) || "(no subject)",
    status: (str(o.status_category) || str(o.status) || "").toLowerCase(),
    preview: preview.replace(/\s+/g, " ").trim().slice(0, 200),
    correspondent: correspondentOf(o),
    updatedAt:
      toIso(last?.created_at) ?? toIso(o.waiting_since) ?? toIso(o.created_at),
    tags,
    link: str(links?.self) || null,
  };
}

/** List the open Front conversations, newest activity first. */
export async function listOpenFrontConversations(): Promise<FrontInboxResult> {
  const server = await resolveFrontServer();
  if (!server) return { connected: false };

  try {
    const tools = await listMcpTools(server);
    const toolName = pickListTool(tools);
    if (!toolName) {
      return {
        connected: true,
        error:
          "Connected to Front, but couldn't find a 'list conversations' tool on that MCP server.",
      };
    }

    // No args: list across the account's accessible inboxes. (The Front/
    // Pipedream list tool defaults to the connected account's conversations.)
    const text = await callMcpTool(server, toolName, {});
    let parsed: unknown;
    try {
      parsed = JSON.parse(text);
    } catch {
      return { connected: true, error: "Front returned an unexpected response." };
    }

    const conversations = extractConversations(parsed)
      .filter(isOpen)
      .map(mapConversation)
      .filter((c): c is FrontConversation => c !== null)
      .sort((a, b) => (b.updatedAt ?? "").localeCompare(a.updatedAt ?? ""));

    return {
      connected: true,
      account: server.accountLabel ?? server.app ?? server.name,
      conversations,
    };
  } catch (e) {
    const error = e instanceof Error ? e.message : "Front request failed.";
    return { connected: true, error };
  }
}

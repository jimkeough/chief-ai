// Front inbox source — lists the OPEN conversations from a connected Front
// account and surfaces them on the Inbox screen, alongside (and independent of)
// the IMAP/Gmail email triage.
//
// Front is reached the same way every other connector is: through the MCP
// broker (lib/mcp-broker.ts). Front is wired up as a direct MCP connection,
// typically named/app-slugged "frontapp". We find that server, list its tools,
// call its conversations tool, and map the result into a UI-friendly shape.
//
// Everything here is read-only and fails soft: a missing/misbehaving Front
// connection returns "not connected" or an error string, never throws, so the
// email inbox keeps working regardless.

import { getMcpServers, type McpServerConfig } from "@/lib/mcp";
import { listMcpTools, callMcpTool, type McpToolDef } from "@/lib/mcp-broker";
import { frontMcpServer } from "@/lib/front-mcp";

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
  /** Link that opens the conversation in Front, or null. */
  link: string | null;
};

export type FrontInboxResult =
  | { connected: false }
  | { connected: true; account?: string | null; conversations: FrontConversation[] }
  | { connected: true; error: string };

const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, "");

/** True when a broker server looks like a Front connector. */
function isFrontServer(s: McpServerConfig): boolean {
  const app = norm(s.app ?? "");
  if (app === "front" || app === "frontapp") return true;
  const name = (s.name ?? "").toLowerCase();
  return /(?:^|[^a-z0-9])front(?:app)?(?:$|[^a-z0-9])/.test(name);
}

/** Find the user's direct Front MCP connection. */
export async function resolveFrontServer(): Promise<McpServerConfig | null> {
  const official = await frontMcpServer().catch(() => null);
  if (official) return official;
  const manual = await getMcpServers().catch(() => []);
  return manual.find(isFrontServer) ?? null;
}

/** Choose a read-only tool that lists/searches conversations without bypassing
 *  the broker's read-only classification. */
function pickListTool(tools: McpToolDef[]): McpToolDef | null {
  const scored = tools
    .filter((t) => t.readOnly)
    .map((t) => {
      const n = norm(t.name);
      const hasConv = n.includes("conversation");
      if (!hasConv) return { tool: t, score: 0 };
      let score = 0;
      if (n.includes("listconversations")) score += 10;
      else if (n.includes("searchconversations")) score += 6;
      else if (n.includes("list")) score += 3;
      if (n.includes("inbox")) score += 1;
      if (n.includes("message")) score -= 10;
      if (n.includes("tagged") || n.includes("contact")) score -= 5;
      return { tool: t, score };
    })
    .filter((x) => x.score > 0)
    .sort((a, b) => b.score - a.score);
  return scored[0]?.tool ?? null;
}

function toolArgs(tool: McpToolDef): Record<string, unknown> {
  const properties = isRec(tool.inputSchema.properties)
    ? tool.inputSchema.properties
    : {};
  const n = norm(tool.name);

  // Front's official MCP requires a query or filter. all_inboxes includes
  // unassigned work, while the status filter requests only open records before
  // the response is defensively filtered again below.
  if (n.includes("searchconversations")) {
    return { scope: "all_inboxes", filters: { status: "open" } };
  }

  // Some list tools paginate internally via maxResults; others expose limit.
  if ("maxResults" in properties) return { maxResults: 100 };
  if ("limit" in properties) return { limit: 100 };
  return {};
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
  return false;
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
      toIso(o.updated_at) ??
      toIso(last?.created_at) ??
      toIso(o.waiting_since) ??
      toIso(o.created_at),
    tags,
    link: /^cnv_[a-zA-Z0-9]+$/.test(id)
      ? `https://app.frontapp.com/open/${encodeURIComponent(id)}`
      : null,
  };
}

function parseMcpJson(text: string): unknown {
  const trimmed = text.trim();
  const candidates = [trimmed];
  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)\s*```/i)?.[1];
  if (fenced) candidates.push(fenced);
  const firstObject = trimmed.indexOf("{");
  const lastObject = trimmed.lastIndexOf("}");
  if (firstObject >= 0 && lastObject > firstObject) {
    candidates.push(trimmed.slice(firstObject, lastObject + 1));
  }
  const firstArray = trimmed.indexOf("[");
  const lastArray = trimmed.lastIndexOf("]");
  if (firstArray >= 0 && lastArray > firstArray) {
    candidates.push(trimmed.slice(firstArray, lastArray + 1));
  }

  for (const candidate of candidates) {
    try {
      return JSON.parse(candidate);
    } catch {
      // Try the next plausible JSON envelope.
    }
  }
  throw new Error("Front returned an unexpected response.");
}

/** List the open Front conversations, newest activity first. */
export async function listOpenFrontConversations(): Promise<FrontInboxResult> {
  const server = await resolveFrontServer();
  if (!server) return { connected: false };

  try {
    const tools = await listMcpTools(server);
    const tool = pickListTool(tools);
    if (!tool) {
      return {
        connected: true,
        error:
          "Connected to Front, but couldn't find a read-only conversations tool on that MCP server.",
      };
    }

    const text = await callMcpTool(server, tool.name, toolArgs(tool));
    const parsed = parseMcpJson(text);

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

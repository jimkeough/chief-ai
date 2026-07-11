// Generic MCP broker: lets Chief use a remote MCP server through the app's
// human-in-the-loop gate instead of Anthropic's hosted connector.
//
// Why this exists: the hosted connector runs tool calls server-side with no
// interception point, so a write would fire with no approval. Every configured
// server is routed here instead — we list its tools, run the READ-ONLY ones
// transparently, and turn every other (writing) tool into an approve/reject
// proposal that only executes on an explicit click.
//
// Read vs. write is decided by each tool's MCP `readOnlyHint` annotation, with a
// safe default: anything not clearly read-only is treated as a write (gated).
// An optional per-server `allowedTools` SCOPES which tools are exposed at all
// (handy to keep a big server's tool count — and token cost — down).

import type { McpServerConfig } from "@/lib/mcp";

export type McpToolDef = {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
  /** True when the tool is safe to run without approval (read-only). */
  readOnly: boolean;
};

// Anthropic requires tool names to match this; skip anything that wouldn't be
// accepted rather than 400 the whole request.
const TOOL_NAME_RE = /^[a-zA-Z0-9_-]{1,64}$/;
const PIPEDREAM_CONNECT_ENTITLEMENT_ERROR =
  /Connect component API not enabled for this organization/i;
const PIPEDREAM_CONNECT_ENTITLEMENT_MESSAGE =
  "Pipedream rejected this connector because its organization does not have the Connect component API enabled. The Pipedream organization owner must enable that entitlement; reconnecting the app or changing MCP routing will not fix it.";

/**
 * Convert an MCP tool result into an actionable error when needed. Pipedream
 * can return action-level failures inside an `isError: false` MCP envelope, so
 * recognize its organization-entitlement denial from the text as well.
 */
export function mcpToolResultError(
  text: string,
  isError: boolean,
): string | null {
  if (PIPEDREAM_CONNECT_ENTITLEMENT_ERROR.test(text)) {
    return PIPEDREAM_CONNECT_ENTITLEMENT_MESSAGE;
  }
  if (isError) return text || "The MCP server rejected the request.";
  return null;
}

async function connect(server: McpServerConfig) {
  const { Client } = await import("@modelcontextprotocol/sdk/client/index.js");
  const { StreamableHTTPClientTransport } = await import(
    "@modelcontextprotocol/sdk/client/streamableHttp.js"
  );
  const transport = new StreamableHTTPClientTransport(new URL(server.url), {
    requestInit: server.authorization_token
      ? { headers: { Authorization: `Bearer ${server.authorization_token}` } }
      : undefined,
  });
  const client = new Client(
    { name: "chief-mcp-broker", version: "1.0.0" },
    { capabilities: {} },
  );
  await client.connect(transport);
  return client;
}

// Tool lists rarely change; cache briefly so we don't reconnect+list on every
// chat turn. Keyed by url (the token doesn't change which tools exist).
type CacheEntry = { tools: McpToolDef[]; at: number };
const TOOL_CACHE = new Map<string, CacheEntry>();
const CACHE_TTL_MS = 60_000;

/** List a server's tools, classified read vs. write. Cached briefly. */
export async function listMcpTools(server: McpServerConfig): Promise<McpToolDef[]> {
  const cached = TOOL_CACHE.get(server.url);
  if (cached && Date.now() - cached.at < CACHE_TTL_MS) return cached.tools;

  // When set, allowedTools scopes WHICH tools are exposed (not their read/write
  // classification — that's always the readOnlyHint).
  const scope = server.allowedTools?.length
    ? new Set(server.allowedTools.map((t) => t.toLowerCase()))
    : null;
  let client: Awaited<ReturnType<typeof connect>> | null = null;
  try {
    client = await connect(server);
    const { tools } = await client.listTools();
    const defs: McpToolDef[] = [];
    // When the server carries a toolPrefix, its tools are exposed under it so
    // they don't collide with other servers' identically-named tools.
    // callMcpTool strips it symmetrically.
    const prefix = server.toolPrefix ?? "";
    for (const t of tools ?? []) {
      if (!TOOL_NAME_RE.test(t.name)) continue;
      if (scope && !scope.has(t.name.toLowerCase())) continue;
      const exposedName = `${prefix}${t.name}`;
      // A prefixed name that no longer satisfies Anthropic's tool-name rule
      // (e.g. too long) can't be attached — skip it rather than 400 the request.
      if (prefix && !TOOL_NAME_RE.test(exposedName)) continue;
      // Run a tool transparently only when it's clearly a pure read. MCP
      // annotations are human-authored hints (and sometimes wrong), so we err
      // toward gating: a tool counts as read-only only if readOnlyHint is set
      // AND it isn't also flagged destructive. Anything else — including
      // unannotated tools — defaults to a gated write.
      //
      // NB: we deliberately ignore openWorldHint. It means "interacts with an
      // external/open world", which is true for essentially every connector
      // tool (Slack, GitHub, Calendar — reads included), so gating on it would
      // classify ALL of them as writes (verified live in the app this was
      // ported from). It's not a write signal; readOnlyHint + destructive are.
      const annotations = (
        t as {
          annotations?: {
            readOnlyHint?: boolean;
            destructiveHint?: boolean;
          };
        }
      ).annotations;
      const readOnly =
        annotations?.readOnlyHint === true &&
        annotations?.destructiveHint !== true;
      defs.push({
        name: exposedName,
        description: t.description ?? "",
        inputSchema: (t.inputSchema as Record<string, unknown>) ?? {
          type: "object",
          properties: {},
        },
        readOnly,
      });
    }
    TOOL_CACHE.set(server.url, { tools: defs, at: Date.now() });
    return defs;
  } finally {
    await client?.close().catch(() => {});
  }
}

/** Call one tool on a server and return its text result. Used both to run
 *  read tools in the chat loop and to execute an approved write. */
export async function callMcpTool(
  server: McpServerConfig,
  toolName: string,
  args: Record<string, unknown>,
): Promise<string> {
  // Undo the prefix listMcpTools added: the remote server only knows the bare
  // tool name. Symmetric with the prefixing above.
  const remoteName =
    server.toolPrefix && toolName.startsWith(server.toolPrefix)
      ? toolName.slice(server.toolPrefix.length)
      : toolName;
  let client: Awaited<ReturnType<typeof connect>> | null = null;
  try {
    client = await connect(server);
    const res = await client.callTool({ name: remoteName, arguments: args });
    const blocks = (res?.content ?? []) as Array<{ type?: string; text?: string }>;
    const text = blocks
      .map((c) => (c.type === "text" ? (c.text ?? "") : ""))
      .filter(Boolean)
      .join("\n")
      .trim();
    const error = mcpToolResultError(
      text,
      Boolean((res as { isError?: boolean })?.isError),
    );
    if (error) throw new Error(error);
    return text || "Done.";
  } finally {
    await client?.close().catch(() => {});
  }
}

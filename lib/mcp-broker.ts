// Generic MCP broker: lets Chief use a remote MCP server through the app's
// human-in-the-loop gate instead of Anthropic's hosted connector.
//
// Why this exists: the hosted connector runs tool calls server-side with no
// interception point, so a write would fire with no approval. Every configured
// server is routed here instead — we list its tools, run the READ-ONLY ones
// transparently, and turn every other (writing) tool into an approve/reject
// proposal that only executes on an explicit click.
//
// Managed servers classify reads from MCP `readOnlyHint`; direct user-supplied
// servers default every tool to gated until the user explicitly trusts those
// annotations. Anything not clearly read-only is always treated as a write.
// An optional per-server `allowedTools` SCOPES which tools are exposed at all
// (handy to keep a big server's tool count — and token cost — down).

import type { McpServerConfig } from "@/lib/mcp";
import { createHash } from "node:crypto";
import { safeMcpFetch, validateMcpUrl } from "@/lib/mcp-url";

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

async function connect(server: McpServerConfig) {
  const { Client } = await import("@modelcontextprotocol/sdk/client/index.js");
  const { StreamableHTTPClientTransport } = await import(
    "@modelcontextprotocol/sdk/client/streamableHttp.js"
  );
  const url = await validateMcpUrl(server.url);
  const headers = {
    ...(server.headers ?? {}),
    ...(server.authorization_token
      ? { Authorization: `Bearer ${server.authorization_token}` }
      : {}),
  };
  const transport = new StreamableHTTPClientTransport(url, {
    fetch: safeMcpFetch,
    requestInit: Object.keys(headers).length ? { headers } : undefined,
  });
  const client = new Client(
    { name: "chief-mcp-broker", version: "1.0.0" },
    { capabilities: {} },
  );
  await client.connect(transport);
  return client;
}

// Tool lists rarely change; cache briefly so we don't reconnect+list on every
// chat turn. Config and credential fingerprints isolate distinct connections.
type CacheEntry = { tools: McpToolDef[]; at: number };
const TOOL_CACHE = new Map<string, CacheEntry>();
const CACHE_TTL_MS = 60_000;

function toolCacheKey(server: McpServerConfig): string {
  const tokenFingerprint = server.authorization_token
    ? createHash("sha256").update(server.authorization_token).digest("hex")
    : "";
  const headersFingerprint = server.headers
    ? createHash("sha256")
        .update(JSON.stringify(Object.entries(server.headers).sort(([a], [b]) => a.localeCompare(b))))
        .digest("hex")
    : "";
  return JSON.stringify({
    url: server.url,
    tokenFingerprint,
    headersFingerprint,
    allowedTools: server.allowedTools ?? null,
    toolPrefix: server.toolPrefix ?? "",
    trustAnnotations: server.trustAnnotations ?? null,
  });
}

export function invalidateMcpToolCache(): void {
  TOOL_CACHE.clear();
}

/** List a server's tools, classified read vs. write. Cached briefly. */
export async function listMcpTools(
  server: McpServerConfig,
  options?: { bypassCache?: boolean },
): Promise<McpToolDef[]> {
  const cacheKey = toolCacheKey(server);
  const cached = TOOL_CACHE.get(cacheKey);
  if (
    !options?.bypassCache &&
    cached &&
    Date.now() - cached.at < CACHE_TTL_MS
  ) {
    return cached.tools;
  }

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
        server.trustAnnotations !== false &&
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
    TOOL_CACHE.set(cacheKey, { tools: defs, at: Date.now() });
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
    // MCP results carry more than plain text: a tool can return the payload as an
    // embedded `resource` (with inline text OR a base64 `blob`) or a
    // `resource_link`. GitHub's get_file_contents, for one, returns the file body
    // as a resource block and only a "successfully downloaded" line as text — so
    // extracting `text` alone drops the actual content. Render every block kind.
    const blocks = (res?.content ?? []) as Array<{
      type?: string;
      text?: string;
      data?: string;
      mimeType?: string;
      uri?: string;
      name?: string;
      resource?: { uri?: string; mimeType?: string; text?: string; blob?: string };
    }>;
    const looksTextual = (mime?: string): boolean =>
      !mime ||
      /^text\//i.test(mime) ||
      /(json|xml|javascript|typescript|yaml|toml|csv|markdown|html|svg|x-sh|source)/i.test(
        mime,
      );
    const decodeBlob = (b64: string): string => {
      try {
        return Buffer.from(b64, "base64").toString("utf8");
      } catch {
        return "";
      }
    };
    const renderBlock = (c: (typeof blocks)[number]): string => {
      if (c.type === "text") return c.text ?? "";
      if (c.type === "resource" && c.resource) {
        const r = c.resource;
        if (typeof r.text === "string" && r.text) return r.text;
        if (typeof r.blob === "string" && r.blob) {
          const decoded = looksTextual(r.mimeType) ? decodeBlob(r.blob) : "";
          return (
            decoded ||
            `[binary resource${r.uri ? ` ${r.uri}` : ""} (${r.mimeType ?? "unknown type"}) omitted]`
          );
        }
        return r.uri ? `[resource ${r.uri}]` : "";
      }
      if (c.type === "resource_link" && c.uri) {
        return `[resource: ${c.name ?? c.uri} — ${c.uri}]`;
      }
      if (c.type === "image") return `[image omitted (${c.mimeType ?? "image"})]`;
      return "";
    };
    // Guard against a huge file blowing the model's context; keep it generous.
    const MAX_RESULT_CHARS = 120_000;
    let text = blocks.map(renderBlock).filter(Boolean).join("\n").trim();
    if (text.length > MAX_RESULT_CHARS) {
      text = `${text.slice(0, MAX_RESULT_CHARS)}\n…[truncated ${text.length - MAX_RESULT_CHARS} chars]`;
    }
    if ((res as { isError?: boolean })?.isError) {
      throw new Error(text || "The MCP server rejected the request.");
    }
    return text || "Done.";
  } finally {
    await client?.close().catch(() => {});
  }
}

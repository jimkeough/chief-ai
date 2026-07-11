// Remote MCP connectors. The user configures a JSON array of MCP servers in
// settings (key "mcp.servers"); Chief brokers their tools alongside its
// built-in read/write tools. A malformed config yields an empty list rather
// than throwing — a bad setting should never break the chat.
//
// Unlike the app this was ported from, there is no hosted-connector path here:
// EVERY configured server is brokered (lib/mcp-broker.ts), so read-only tools
// run transparently and anything that writes becomes an approve/reject
// proposal. The `gated` flag is accepted for config compatibility but the
// broker treatment is unconditional.

import { getSetting } from "@/lib/settings";
import {
  getRuntimeMcpConnections,
  migrateLegacyMcpConnections,
} from "@/lib/mcp-connections";
import { createClient } from "@/lib/supabase/server";

export type McpServerConfig = {
  /** Stable database id for structured manual connections. */
  id?: string;
  name: string;
  url: string;
  authorization_token?: string;
  /**
   * Read-only allowlist: when set, only these tool names are exposed to the
   * model (everything else is disabled). Undefined means no filtering — the
   * server's full tool set is exposed (the user vets their own servers).
   */
  allowedTools?: string[];
  /** Accepted for compatibility; every server is brokered regardless. */
  gated?: boolean;
  /**
   * Short app slug for display ("github", "supabase"). Optional; falls back
   * to `name`.
   */
  app?: string;
  /**
   * Human label distinguishing multiple accounts of one app, shown next to
   * the app name on proposal cards.
   */
  accountLabel?: string;
  /**
   * When set, every tool this server exposes is presented to the model under
   * `toolPrefix + realName`, and the broker strips it back off before calling
   * the remote server. Keeps tool names unique across servers whose underlying
   * tool names would otherwise collide.
   */
  toolPrefix?: string;
  /**
   * Manual servers default false: remote read-only annotations are only trusted
   * after the user opts in. Managed/built-in servers omit this and retain their
   * annotation-based behavior.
   */
  trustAnnotations?: boolean;
};

export function parseMcpServers(raw: string): McpServerConfig[] {
  const text = raw.trim();
  if (!text) return [];
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return [];
  }
  if (!Array.isArray(parsed)) return [];

  const servers: McpServerConfig[] = [];
  for (const item of parsed) {
    if (!item || typeof item !== "object") continue;
    const o = item as Record<string, unknown>;
    const name = typeof o.name === "string" ? o.name.trim() : "";
    const url = typeof o.url === "string" ? o.url.trim() : "";
    if (!name || !url) continue;
    // Accept either `authorization_token` or a looser `token` alias.
    const token =
      typeof o.authorization_token === "string"
        ? o.authorization_token
        : typeof o.token === "string"
          ? o.token
          : undefined;
    const allowedTools = Array.isArray(o.allowedTools)
      ? o.allowedTools.filter((t): t is string => typeof t === "string")
      : undefined;
    servers.push({
      name,
      url,
      ...(token ? { authorization_token: token } : {}),
      ...(allowedTools ? { allowedTools } : {}),
      ...(o.gated === true ? { gated: true } : {}),
      ...(typeof o.app === "string" && o.app.trim() ? { app: o.app.trim() } : {}),
      ...(typeof o.accountLabel === "string" && o.accountLabel.trim()
        ? { accountLabel: o.accountLabel.trim() }
        : {}),
      ...(typeof o.toolPrefix === "string" && o.toolPrefix.trim()
        ? { toolPrefix: o.toolPrefix.trim() }
        : {}),
    });
  }
  return servers;
}

export async function getMcpServers(): Promise<McpServerConfig[]> {
  let secure: McpServerConfig[] = [];
  try {
    secure = await getRuntimeMcpConnections();
  } catch (error) {
    // Deployments briefly running new code before the migration lands retain
    // legacy connector access instead of breaking Chief.
    console.error("Secure MCP connections unavailable:", error);
  }

  let legacy = parseMcpServers(await getSetting("mcp.servers"));
  if (legacy.length > 0) {
    try {
      const supabase = await createClient();
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (user) {
        const migration = await migrateLegacyMcpConnections(user.id, legacy);
        legacy = migration.remaining;
        if (migration.imported > 0) {
          secure = await getRuntimeMcpConnections();
        }
        if (migration.errors.length > 0) {
          console.error("Some legacy MCP connections could not be migrated:", migration.errors);
        }
      }
    } catch (error) {
      // Keep the legacy path alive if Vault or the new table is temporarily
      // unavailable; successful entries are removed from plaintext as they move.
      console.error("Legacy MCP migration unavailable:", error);
    }
  }
  const names = new Set(secure.map((server) => server.name.toLowerCase()));
  return [
    ...secure,
    ...legacy.filter((server) => !names.has(server.name.toLowerCase())),
  ];
}

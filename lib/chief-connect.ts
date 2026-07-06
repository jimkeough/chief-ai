// Chief Connect — the optional paid connector hub, ported from Email-wrapper's
// battle-tested Pipedream Connect integration with one structural change: this
// app never holds the operator's Pipedream credentials. A small vendor service
// (connect-service/) does, and this module talks to it with the user's
// subscription key to obtain (a) a short-lived access token for Pipedream's
// MCP servers, (b) hosted Connect Links for 2-click managed OAuth, and (c) the
// connected-account list.
//
// The trust contract is unchanged: connect servers flow through the SAME
// broker as everything else — reads run transparently, writes become approval
// cards — and every connector has a sovereign twin (app password, own OAuth
// client, direct MCP URL), so this whole layer is ejectable. Blank settings =
// the layer is off and the app is exactly as sovereign as before.

import { getAppSettings, saveAppSettings } from "@/lib/settings";
import type { McpServerConfig } from "@/lib/mcp";

const MCP_BASE = "https://remote.mcp.pipedream.net/v3";

type ConnectConfig = { url: string; key: string; apps: string[] };

/** The user's Chief Connect settings, or null when the layer is off. */
export async function getConnectConfig(): Promise<ConnectConfig | null> {
  const settings = await getAppSettings();
  const url = settings["connect.service_url"].trim().replace(/\/$/, "");
  const key = settings["connect.api_key"].trim();
  if (!url || !key) return null;
  const apps = settings["connect.apps"]
    .split(",")
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
  return { url, key, apps };
}

async function serviceFetch<T>(
  cfg: ConnectConfig,
  path: string,
  body?: Record<string, unknown>,
): Promise<T> {
  const res = await fetch(`${cfg.url}${path}`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${cfg.key}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body ?? {}),
  });
  const data = (await res.json().catch(() => ({}))) as T & { error?: string };
  if (!res.ok) {
    throw new Error(data.error ?? `Chief Connect ${path} failed (${res.status}).`);
  }
  return data;
}

type McpToken = {
  accessToken: string;
  expiresAt: string;
  projectId: string;
  environment: string;
  externalUserId: string;
};

// Access-token cache per (service, key) — refreshed near expiry.
const TOKEN_CACHE = new Map<string, { token: McpToken; exp: number }>();

async function getMcpToken(cfg: ConnectConfig): Promise<McpToken> {
  const cacheKey = `${cfg.url}|${cfg.key}`;
  const cached = TOKEN_CACHE.get(cacheKey);
  if (cached && cached.exp > Date.now() + 60_000) return cached.token;
  const token = await serviceFetch<McpToken>(cfg, "/api/mcp-token");
  TOKEN_CACHE.set(cacheKey, {
    token,
    exp: Date.parse(token.expiresAt) || Date.now() + 30 * 60_000,
  });
  return token;
}

export type ConnectAccount = {
  id: string;
  app: string;
  name?: string;
  healthy: boolean;
};

export async function listConnectAccounts(
  cfg?: ConnectConfig | null,
): Promise<ConnectAccount[]> {
  const config = cfg ?? (await getConnectConfig());
  if (!config) return [];
  const data = await serviceFetch<{ accounts: ConnectAccount[] }>(
    config,
    "/api/accounts",
  );
  return data.accounts ?? [];
}

/** A hosted Connect Link URL for the managed-OAuth flow (append per app). */
export async function getConnectLink(app?: string): Promise<string> {
  const config = await getConnectConfig();
  if (!config) throw new Error("Chief Connect isn't configured.");
  const data = await serviceFetch<{ connectLinkUrl?: string }>(
    config,
    "/api/connect-link",
  );
  if (!data.connectLinkUrl) throw new Error("No connect link returned.");
  return app ? `${data.connectLinkUrl}&app=${encodeURIComponent(app)}` : data.connectLinkUrl;
}

export type CatalogApp = {
  slug: string;
  name: string;
  description?: string;
  img?: string;
};

/** Search Pipedream's app catalog by name, via the Connect service. */
export async function searchConnectApps(q: string): Promise<CatalogApp[]> {
  const config = await getConnectConfig();
  if (!config || !q.trim()) return [];
  const data = await serviceFetch<{ apps: CatalogApp[] }>(config, "/api/apps", {
    q: q.trim(),
  });
  return data.apps ?? [];
}

/** Add an app slug to the enabled list (idempotent). */
export async function addConnectApp(
  userId: string,
  slug: string,
): Promise<void> {
  const clean = slug.trim().toLowerCase();
  if (!clean) return;
  const settings = await getAppSettings();
  const apps = settings["connect.apps"]
    .split(",")
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
  if (!apps.includes(clean)) {
    apps.push(clean);
    await saveAppSettings({ "connect.apps": apps.join(", ") }, userId);
  }
}

export async function disconnectConnectAccount(accountId: string): Promise<void> {
  const config = await getConnectConfig();
  if (!config) throw new Error("Chief Connect isn't configured.");
  await serviceFetch(config, "/api/disconnect", { accountId });
}

function buildMcpUrl(
  token: McpToken,
  app: string,
  accountId?: string,
): string {
  return (
    `${MCP_BASE}?projectId=${encodeURIComponent(token.projectId)}` +
    `&environment=${encodeURIComponent(token.environment)}` +
    `&externalUserId=${encodeURIComponent(token.externalUserId)}` +
    `&app=${encodeURIComponent(app)}` +
    (accountId ? `&accountId=${encodeURIComponent(accountId)}` : "")
  );
}

// Deterministic per-account tool-name prefix (multi-account apps), identical
// derivation to the source app so the chat loop and executor agree.
const accountToolPrefix = (accountId: string) =>
  `${accountId.replace(/[^a-zA-Z0-9]/g, "")}_`;
const accountServerName = (app: string, accountId: string) =>
  `pipedream-${app}-${accountId.replace(/[^a-zA-Z0-9]/g, "")}`;

/**
 * Broker configs for the user's CONNECTED Chief Connect apps (enabled ∩
 * healthy). One server per app; multiple accounts of one app get one server
 * each, account-scoped and tool-namespaced. Returns [] (never throws) when the
 * layer is off or the service is unreachable — a Connect outage must never
 * break the chat.
 */
export async function getConnectServers(): Promise<McpServerConfig[]> {
  try {
    const config = await getConnectConfig();
    if (!config || config.apps.length === 0) return [];
    const [token, accounts] = await Promise.all([
      getMcpToken(config),
      listConnectAccounts(config),
    ]);
    const healthy = accounts.filter((a) => a.healthy);
    const byApp = new Map<string, ConnectAccount[]>();
    for (const a of healthy) {
      if (!config.apps.includes(a.app)) continue;
      const list = byApp.get(a.app) ?? [];
      list.push(a);
      byApp.set(a.app, list);
    }
    const out: McpServerConfig[] = [];
    for (const [app, appAccounts] of byApp) {
      if (appAccounts.length === 1) {
        out.push({
          name: `pipedream-${app}`,
          app,
          url: buildMcpUrl(token, app),
          authorization_token: token.accessToken,
          ...(appAccounts[0].name ? { accountLabel: appAccounts[0].name } : {}),
        });
        continue;
      }
      appAccounts.forEach((acct, i) => {
        out.push({
          name: accountServerName(app, acct.id),
          app,
          url: buildMcpUrl(token, app, acct.id),
          authorization_token: token.accessToken,
          accountLabel: acct.name ?? `${app} #${i + 1}`,
          toolPrefix: accountToolPrefix(acct.id),
        });
      });
    }
    return out;
  } catch (e) {
    console.error("Chief Connect unavailable:", e);
    return [];
  }
}

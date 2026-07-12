import { createHash } from "node:crypto";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import type { McpServerConfig } from "@/lib/mcp";

const PIPEDREAM_API = "https://api.pipedream.com/v1";
export const PIPEDREAM_MCP_URL = "https://remote.mcp.pipedream.net/v3";

export type PipedreamEnvironment = "development" | "production";

export type PipedreamConfigInput = {
  projectId: string;
  clientId: string;
  clientSecret: string;
  environment: PipedreamEnvironment;
};

export type PipedreamConfigStatus = {
  configured: boolean;
  projectId: string | null;
  environment: PipedreamEnvironment | null;
};

export type PipedreamApp = {
  slug: string;
  name: string;
  description: string | null;
  img: string | null;
};

export type PipedreamConnection = {
  id: string;
  accountId: string;
  appSlug: string;
  appName: string;
  accountName: string | null;
  healthy: boolean;
  serverName: string;
};

type RuntimeConfig = {
  projectId: string;
  environment: PipedreamEnvironment;
  clientId: string;
  clientSecret: string;
};

type RuntimeConfigRow = {
  project_id: string;
  environment: PipedreamEnvironment;
  credentials: string;
};

type PipedreamAccountApi = {
  id?: unknown;
  name?: unknown;
  healthy?: unknown;
  dead?: unknown;
  app?: {
    name_slug?: unknown;
    nameSlug?: unknown;
    name?: unknown;
  } | null;
};

type ConnectionRow = {
  id: string;
  account_id: string;
  app_slug: string;
  app_name: string;
  account_name: string | null;
  healthy: boolean;
};

type AccessToken = { token: string; expiresAt: number };

const tokenCache = new Map<string, AccessToken>();

function clean(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function parseInput(raw: unknown): PipedreamConfigInput {
  const body = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
  const projectId = clean(body.projectId);
  const clientId = clean(body.clientId);
  const clientSecret = clean(body.clientSecret);
  const environment =
    body.environment === "production" ? "production" : body.environment === "development"
      ? "development"
      : null;

  if (!/^proj_[a-zA-Z0-9]+$/.test(projectId)) {
    throw new Error("Enter a Pipedream project ID beginning with proj_.");
  }
  if (!clientId || clientId.length > 512) {
    throw new Error("Enter the Pipedream OAuth client ID.");
  }
  if (!clientSecret || clientSecret.length > 2048) {
    throw new Error("Enter the Pipedream OAuth client secret.");
  }
  if (!environment) {
    throw new Error("Choose the Pipedream project environment.");
  }
  return { projectId, clientId, clientSecret, environment };
}

function credentialsFingerprint(config: RuntimeConfig): string {
  return createHash("sha256")
    .update(`${config.clientId}\0${config.clientSecret}`)
    .digest("hex");
}

async function fetchAccessToken(config: RuntimeConfig): Promise<AccessToken> {
  const cacheKey = `${config.projectId}:${config.environment}:${credentialsFingerprint(config)}`;
  const cached = tokenCache.get(cacheKey);
  if (cached && cached.expiresAt > Date.now() + 60_000) return cached;

  const response = await fetch(`${PIPEDREAM_API}/oauth/token`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      grant_type: "client_credentials",
      client_id: config.clientId,
      client_secret: config.clientSecret,
    }),
    cache: "no-store",
    signal: AbortSignal.timeout(15_000),
  });
  if (!response.ok) {
    throw new Error(
      response.status === 401 || response.status === 403
        ? "Pipedream rejected those OAuth credentials."
        : "Pipedream could not verify those credentials.",
    );
  }
  const data = (await response.json().catch(() => ({}))) as {
    access_token?: unknown;
    expires_in?: unknown;
  };
  const token = clean(data.access_token);
  if (!token) throw new Error("Pipedream returned an invalid access token.");
  const expiresIn =
    typeof data.expires_in === "number" && data.expires_in > 0 ? data.expires_in : 3600;
  const entry = { token, expiresAt: Date.now() + expiresIn * 1000 };
  tokenCache.set(cacheKey, entry);
  return entry;
}

async function runtimeConfig(userId: string): Promise<RuntimeConfig | null> {
  const admin = createAdminClient();
  const { data, error } = await admin.rpc("chief_pipedream_runtime_config", {
    p_user_id: userId,
  });
  if (error) throw new Error(`Could not resolve Pipedream credentials: ${error.message}`);
  const row = ((data ?? []) as RuntimeConfigRow[])[0];
  if (!row) return null;
  let credentials: { clientId?: unknown; clientSecret?: unknown };
  try {
    credentials = JSON.parse(row.credentials) as typeof credentials;
  } catch {
    throw new Error("Stored Pipedream credentials are invalid.");
  }
  const clientId = clean(credentials.clientId);
  const clientSecret = clean(credentials.clientSecret);
  if (!clientId || !clientSecret) throw new Error("Stored Pipedream credentials are incomplete.");
  return {
    projectId: row.project_id,
    environment: row.environment,
    clientId,
    clientSecret,
  };
}

async function requireRuntimeConfig(userId: string): Promise<RuntimeConfig> {
  const config = await runtimeConfig(userId);
  if (!config) throw new Error("Finish Pipedream setup first.");
  return config;
}

async function pipedreamFetch(
  config: RuntimeConfig,
  path: string,
  init: { method?: "GET" | "POST" | "DELETE"; body?: Record<string, unknown> } = {},
): Promise<unknown> {
  const { token } = await fetchAccessToken(config);
  const response = await fetch(`${PIPEDREAM_API}${path}`, {
    method: init.method ?? "GET",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      "x-pd-environment": config.environment,
    },
    ...(init.body ? { body: JSON.stringify(init.body) } : {}),
    cache: "no-store",
    signal: AbortSignal.timeout(20_000),
  });
  if (!response.ok) {
    if (response.status === 401 || response.status === 403) {
      throw new Error("Pipedream rejected the stored project credentials.");
    }
    if (response.status === 404) throw new Error("Pipedream could not find that project or account.");
    if (response.status === 429) throw new Error("Pipedream is rate-limiting requests. Try again shortly.");
    throw new Error(`Pipedream request failed (${response.status}).`);
  }
  if (response.status === 204) return null;
  return response.json().catch(() => null);
}

function accountArray(data: unknown): PipedreamAccountApi[] {
  if (Array.isArray(data)) return data as PipedreamAccountApi[];
  if (data && typeof data === "object" && Array.isArray((data as { data?: unknown }).data)) {
    return (data as { data: PipedreamAccountApi[] }).data;
  }
  return [];
}

async function listRemoteAccounts(
  userId: string,
  suppliedConfig?: RuntimeConfig,
): Promise<Array<{
  accountId: string;
  appSlug: string;
  appName: string;
  accountName: string | null;
  healthy: boolean;
}>> {
  const config = suppliedConfig ?? (await requireRuntimeConfig(userId));
  const data = await pipedreamFetch(
    config,
    `/connect/${encodeURIComponent(config.projectId)}/users/${encodeURIComponent(userId)}/accounts`,
  );
  return accountArray(data)
    .map((account) => {
      const accountId = clean(account.id);
      const appSlug = clean(account.app?.name_slug ?? account.app?.nameSlug);
      const appName = clean(account.app?.name) || appSlug;
      return {
        accountId,
        appSlug,
        appName,
        accountName: clean(account.name) || null,
        healthy: account.healthy !== false && account.dead !== true,
      };
    })
    .filter(
      (account) =>
        /^apn_[a-zA-Z0-9]+$/.test(account.accountId) && Boolean(account.appSlug),
    );
}

function serverName(connectionId: string): string {
  return `pipedream:${connectionId}`;
}

function toPublic(row: ConnectionRow): PipedreamConnection {
  return {
    id: row.id,
    accountId: row.account_id,
    appSlug: row.app_slug,
    appName: row.app_name,
    accountName: row.account_name,
    healthy: row.healthy,
    serverName: serverName(row.id),
  };
}

export async function getPipedreamConfigStatus(
  userId: string,
): Promise<PipedreamConfigStatus> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("pipedream_config")
    .select("project_id,environment")
    .eq("user_id", userId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) return { configured: false, projectId: null, environment: null };
  const hasCredentials = Boolean(await runtimeConfig(userId));
  return {
    configured: hasCredentials,
    projectId: data.project_id as string,
    environment: data.environment as PipedreamEnvironment,
  };
}

export async function savePipedreamConfig(
  userId: string,
  raw: unknown,
): Promise<PipedreamConfigStatus> {
  const input = parseInput(raw);
  const config: RuntimeConfig = input;
  await fetchAccessToken(config);

  const admin = createAdminClient();
  const { error } = await admin.rpc("chief_pipedream_upsert_config", {
    p_user_id: userId,
    p_project_id: input.projectId,
    p_environment: input.environment,
    p_credentials: JSON.stringify({
      clientId: input.clientId,
      clientSecret: input.clientSecret,
    }),
  });
  if (error) throw new Error(`Could not store Pipedream configuration: ${error.message}`);
  return {
    configured: true,
    projectId: input.projectId,
    environment: input.environment,
  };
}

export async function searchPipedreamApps(
  userId: string,
  query: string,
): Promise<PipedreamApp[]> {
  const q = query.trim().slice(0, 100);
  if (!q) return [];
  const config = await requireRuntimeConfig(userId);
  const params = new URLSearchParams({
    q,
    has_components: "true",
    limit: "12",
    sort_key: "featured_weight",
    sort_direction: "desc",
  });
  const data = (await pipedreamFetch(config, `/connect/apps?${params}`)) as {
    data?: unknown;
  } | null;
  const apps = Array.isArray(data?.data) ? data.data : [];
  return apps
    .map((raw) => {
      const app = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
      return {
        slug: clean(app.name_slug ?? app.nameSlug),
        name: clean(app.name),
        description: clean(app.description) || null,
        img: clean(app.img_src ?? app.imgSrc) || null,
      };
    })
    .filter((app) => app.slug && app.name);
}

export async function createPipedreamConnectLink(
  userId: string,
  appSlug: string,
  origin: string,
): Promise<string> {
  const app = appSlug.trim();
  if (!/^[a-zA-Z0-9_-]{1,128}$/.test(app)) throw new Error("Choose a valid Pipedream app.");
  const parsedOrigin = new URL(origin);
  if (!["http:", "https:"].includes(parsedOrigin.protocol)) throw new Error("Invalid return URL.");
  const config = await requireRuntimeConfig(userId);
  const returnUrl = new URL("/config/connections?pipedream=connected", parsedOrigin);
  const errorUrl = new URL("/config/connections?pipedream=error", parsedOrigin);
  const data = (await pipedreamFetch(
    config,
    `/connect/${encodeURIComponent(config.projectId)}/tokens`,
    {
      method: "POST",
      body: {
        external_user_id: userId,
        allowed_origins: [parsedOrigin.origin],
        success_redirect_uri: returnUrl.href,
        error_redirect_uri: errorUrl.href,
        scope: "connect:accounts:read connect:accounts:write",
      },
    },
  )) as { connect_link_url?: unknown } | null;
  const connectLink = clean(data?.connect_link_url);
  if (!connectLink) throw new Error("Pipedream did not return an authorization link.");
  const url = new URL(connectLink);
  if (
    url.protocol !== "https:" ||
    (url.hostname !== "pipedream.com" && !url.hostname.endsWith(".pipedream.com"))
  ) {
    throw new Error("Pipedream returned an invalid authorization link.");
  }
  url.searchParams.set("app", app);
  return url.href;
}

export async function syncPipedreamConnections(
  userId: string,
): Promise<PipedreamConnection[]> {
  const accounts = await listRemoteAccounts(userId);
  const supabase = await createClient();
  if (accounts.length > 0) {
    const { error } = await supabase.from("pipedream_connections").upsert(
      accounts.map((account) => ({
        user_id: userId,
        account_id: account.accountId,
        app_slug: account.appSlug,
        app_name: account.appName,
        account_name: account.accountName,
        healthy: account.healthy,
      })),
      { onConflict: "user_id,account_id" },
    );
    if (error) throw new Error(error.message);
  }

  const remoteIds = accounts.map((account) => account.accountId);
  let stale = supabase.from("pipedream_connections").delete().eq("user_id", userId);
  if (remoteIds.length > 0) stale = stale.not("account_id", "in", `(${remoteIds.join(",")})`);
  const { error: staleError } = await stale;
  if (staleError) throw new Error(staleError.message);

  const { data, error } = await supabase
    .from("pipedream_connections")
    .select("id,account_id,app_slug,app_name,account_name,healthy")
    .eq("user_id", userId)
    .order("created_at", { ascending: true });
  if (error) throw new Error(error.message);
  return ((data ?? []) as ConnectionRow[]).map(toPublic);
}

export async function disconnectPipedreamAccount(
  userId: string,
  connectionId: string,
): Promise<void> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("pipedream_connections")
    .select("id,account_id")
    .eq("id", connectionId)
    .eq("user_id", userId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) throw new Error("Pipedream connection not found.");

  const config = await requireRuntimeConfig(userId);
  const accounts = await listRemoteAccounts(userId, config);
  if (!accounts.some((account) => account.accountId === data.account_id)) {
    await supabase.from("pipedream_connections").delete().eq("id", connectionId);
    return;
  }
  await pipedreamFetch(
    config,
    `/connect/${encodeURIComponent(config.projectId)}/accounts/${encodeURIComponent(data.account_id)}`,
    { method: "DELETE" },
  );
  const { error: deleteError } = await supabase
    .from("pipedream_connections")
    .delete()
    .eq("id", connectionId)
    .eq("user_id", userId);
  if (deleteError) throw new Error(deleteError.message);
}

export async function getRuntimePipedreamServers(
  userId: string,
): Promise<McpServerConfig[]> {
  const config = await runtimeConfig(userId);
  if (!config) return [];
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("pipedream_connections")
    .select("id,account_id,app_slug,app_name,account_name,healthy")
    .eq("user_id", userId)
    .eq("healthy", true)
    .order("created_at", { ascending: true });
  if (error) throw new Error(error.message);
  const rows = (data ?? []) as ConnectionRow[];
  if (rows.length === 0) return [];
  const { token } = await fetchAccessToken(config);
  return rows.map((row) => {
    const safeApp = row.app_slug.replace(/[^a-zA-Z0-9_]/g, "_").slice(0, 12);
    return {
      id: row.id,
      name: serverName(row.id),
      url: PIPEDREAM_MCP_URL,
      authorization_token: token,
      headers: {
        "x-pd-project-id": config.projectId,
        "x-pd-environment": config.environment,
        "x-pd-external-user-id": userId,
        "x-pd-app-slug": row.app_slug,
        "x-pd-account-id": row.account_id,
      },
      app: row.app_name,
      accountLabel: row.account_name ?? row.account_id,
      toolPrefix: `pd_${safeApp}_${row.id.slice(0, 4)}_`,
      trustAnnotations: true,
    };
  });
}

export function publicPipedreamError(error: unknown, fallback: string): string {
  const message = error instanceof Error ? error.message : "";
  if (
    /^(Enter|Choose|Finish Pipedream|Pipedream (rejected|could not|did not|returned|is rate-limiting)|Invalid return URL|Stored Pipedream|Pipedream connection not found)/.test(
      message,
    )
  ) {
    return message;
  }
  return fallback;
}

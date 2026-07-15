import { createHash } from "node:crypto";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import type { McpServerConfig } from "@/lib/mcp";
import { buildPipedreamMcpServerConfig } from "@/lib/pipedream-mcp-config";

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

export type PipedreamTriggerComponent = {
  id: string;
  name: string;
  description: string | null;
  supported: boolean;
  unsupportedReason: string | null;
  configProps: PipedreamTriggerConfigProp[];
};

export type PipedreamTriggerConfigProp = {
  name: string;
  label: string;
  description: string | null;
  multiple: boolean;
  required: boolean;
  options: Array<{ label: string; value: string }>;
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

class PipedreamRequestError extends Error {
  readonly status: number;
  constructor(message: string, status: number) {
    super(message);
    this.name = "PipedreamRequestError";
    this.status = status;
  }
}

function clean(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

/** Pull a human reason from Pipedream or Front-shaped proxy error bodies. */
function proxyFailureReason(detail: Record<string, unknown>): string {
  const nested =
    detail._error && typeof detail._error === "object"
      ? (detail._error as Record<string, unknown>)
      : null;
  const data =
    detail.data && typeof detail.data === "object"
      ? (detail.data as Record<string, unknown>)
      : null;
  const dataError =
    data?._error && typeof data._error === "object"
      ? (data._error as Record<string, unknown>)
      : null;
  const candidates = [
    detail.error,
    detail.message,
    detail.name,
    nested?.message,
    nested?.title,
    dataError?.message,
    data?.message,
    data?.error,
  ];
  for (const candidate of candidates) {
    const text = clean(candidate);
    if (text) return text;
  }
  return "";
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

async function verifyPipedreamProject(config: RuntimeConfig): Promise<void> {
  await pipedreamFetch(
    config,
    `/connect/projects/${encodeURIComponent(config.projectId)}`,
  );
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
    const detail = (await response.json().catch(() => ({}))) as {
      error?: unknown;
      message?: unknown;
    };
    const reason = clean(detail.error ?? detail.message).slice(0, 180);
    if (response.status === 401 || response.status === 403) {
      throw new PipedreamRequestError(
        "Pipedream rejected the stored project credentials.",
        response.status,
      );
    }
    if (response.status === 404) {
      throw new PipedreamRequestError(
        "Pipedream could not find that project or account.",
        response.status,
      );
    }
    if (response.status === 429) {
      throw new PipedreamRequestError(
        "Pipedream is rate-limiting requests. Try again shortly.",
        response.status,
      );
    }
    throw new PipedreamRequestError(
      reason
        ? `Pipedream rejected that request: ${reason}`
        : `Pipedream request failed (${response.status}).`,
      response.status,
    );
  }
  if (response.status === 204) return null;
  return response.json().catch(() => null);
}

function accountArray(data: unknown): PipedreamAccountApi[] | null {
  if (Array.isArray(data)) return data as PipedreamAccountApi[];
  if (data && typeof data === "object" && Array.isArray((data as { data?: unknown }).data)) {
    return (data as { data: PipedreamAccountApi[] }).data;
  }
  return null;
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
  let data: unknown;
  try {
    data = await pipedreamFetch(
      config,
      `/connect/${encodeURIComponent(config.projectId)}/users/${encodeURIComponent(userId)}/accounts`,
    );
  } catch (error) {
    // Pipedream creates the external user on the first hosted authorization.
    // Before that, its per-user accounts endpoint returns 404 instead of [].
    if (error instanceof PipedreamRequestError && error.status === 404) {
      await verifyPipedreamProject(config);
      return [];
    }
    throw error;
  }
  const accounts = accountArray(data);
  if (!accounts) throw new Error("Pipedream returned an invalid account list.");
  const parsed = accounts.map((account) => {
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
  });
  if (
    parsed.some(
      (account) =>
        !/^apn_[a-zA-Z0-9]+$/.test(account.accountId) || !account.appSlug,
    )
  ) {
    throw new Error("Pipedream returned an invalid account list.");
  }
  return parsed;
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
  await verifyPipedreamProject(config);
  const previous = await runtimeConfig(userId);
  if (
    previous &&
    (previous.projectId !== input.projectId ||
      previous.environment !== input.environment)
  ) {
    const supabase = await createClient();
    const { count, error: countError } = await supabase
      .from("pipedream_connections")
      .select("id", { count: "exact", head: true })
      .eq("user_id", userId);
    if (countError) throw new Error(countError.message);
    if ((count ?? 0) > 0) {
      throw new Error(
        "Disconnect Pipedream apps before changing the project or environment.",
      );
    }
  }

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
  opts?: { oauthAppId?: string },
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

  // Custom OAuth client (e.g. Front with Private Resources). Prefer an explicit
  // opt, then Config for frontapp.
  let oauthAppId = clean(opts?.oauthAppId);
  if (!oauthAppId && (app === "frontapp" || app === "front")) {
    const { getAppSettings } = await import("@/lib/settings");
    const settings = await getAppSettings().catch(() => null);
    oauthAppId = clean(settings?.["pipedream.front_oauth_app_id"]);
  }
  if (oauthAppId) {
    if (!/^oa_[a-zA-Z0-9]+$/.test(oauthAppId)) {
      throw new Error(
        "Pipedream Front OAuth app id must look like oa_… (from Pipedream → OAuth Clients).",
      );
    }
    url.searchParams.set("oauthAppId", oauthAppId);
  }
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
  const { data: localConnections, error: localConnectionsError } = await supabase
    .from("pipedream_connections")
    .select("id,account_id")
    .eq("user_id", userId);
  if (localConnectionsError) throw new Error(localConnectionsError.message);
  const staleConnectionIds = ((localConnections ?? []) as Array<{
    id: string;
    account_id: string;
  }>)
    .filter((connection) => !remoteIds.includes(connection.account_id))
    .map((connection) => connection.id);
  if (staleConnectionIds.length > 0) {
    const { data: staleTriggers, error: staleTriggersError } = await supabase
      .from("chief_triggers")
      .select("id")
      .in("connection_id", staleConnectionIds);
    if (staleTriggersError) throw new Error(staleTriggersError.message);
    for (const trigger of (staleTriggers ?? []) as Array<{ id: string }>) {
      await deletePipedreamTrigger(userId, trigger.id);
    }
  }
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

type RuntimeTriggerComponent = PipedreamTriggerComponent & {
  appPropName: string | null;
};

function triggerConfigProp(raw: unknown): PipedreamTriggerConfigProp | null {
  const prop = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
  const type = clean(prop.type);
  const name = clean(prop.name);
  if (!name || !["string", "string[]"].includes(type) || !Array.isArray(prop.options)) {
    return null;
  }
  const options = prop.options
    .map((rawOption) => {
      if (typeof rawOption === "string") {
        return {
          label: rawOption
            .split("_")
            .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
            .join(" "),
          value: rawOption,
        };
      }
      const option =
        rawOption && typeof rawOption === "object"
          ? (rawOption as Record<string, unknown>)
          : {};
      const value = clean(option.value);
      if (!value) return null;
      return { label: clean(option.label) || value, value };
    })
    .filter((option): option is { label: string; value: string } => Boolean(option));
  if (options.length === 0) return null;
  return {
    name,
    label: clean(prop.label) || name,
    description: clean(prop.description) || null,
    multiple: type === "string[]",
    required: prop.optional !== true,
    options,
  };
}

function presentTrigger(
  app: string,
  component: RuntimeTriggerComponent,
): RuntimeTriggerComponent {
  if (app !== "frontapp") return component;
  if (component.id === "frontapp-new-conversation-created") {
    return {
      ...component,
      name: "New conversation",
      description: "Pipedream's current Front cursor can miss new conversations.",
      supported: false,
      unsupportedReason:
        "Chief will offer this when Pipedream's Front cursor is safe to use.",
    };
  }
  if (component.id === "frontapp-new-conversation-state-change") {
    return {
      ...component,
      name: "Front activity",
      description: "Mention and inbound-message events are not reliable upstream yet.",
      supported: false,
      unsupportedReason:
        "Chief will offer this when Pipedream's Front event cursor is safe to use.",
      configProps: [],
    };
  }
  return component;
}

async function triggerComponents(
  userId: string,
  appSlug: string,
): Promise<RuntimeTriggerComponent[]> {
  const app = appSlug.trim();
  if (!/^[a-zA-Z0-9_-]{1,128}$/.test(app)) return [];
  const config = await requireRuntimeConfig(userId);
  const params = new URLSearchParams({
    app,
    registry: "public",
    limit: "30",
  });
  const response = (await pipedreamFetch(
    config,
    `/connect/${encodeURIComponent(config.projectId)}/triggers?${params}`,
  )) as { data?: unknown } | null;
  const components = Array.isArray(response?.data) ? response.data : [];
  return components
    .map((raw) => {
      const component =
        raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
      const props = Array.isArray(component.configurable_props)
        ? component.configurable_props
        : [];
      const appProp =
        props.find((rawProp) => {
          const prop =
            rawProp && typeof rawProp === "object"
              ? (rawProp as Record<string, unknown>)
              : {};
          return prop.type === "app" && clean(prop.app) === app;
        }) ??
        props.find((rawProp) => {
          const prop =
            rawProp && typeof rawProp === "object"
              ? (rawProp as Record<string, unknown>)
              : {};
          return prop.type === "app";
        });
      const prop =
        appProp && typeof appProp === "object"
          ? (appProp as Record<string, unknown>)
          : {};
      const id = clean(component.key ?? component.id);
      const configProps = props
        .map(triggerConfigProp)
        .filter((configProp): configProp is PipedreamTriggerConfigProp =>
          Boolean(configProp),
        );
      const unsupportedProps = props.filter((rawProp) => {
        const candidate =
          rawProp && typeof rawProp === "object"
            ? (rawProp as Record<string, unknown>)
            : {};
        const type = clean(candidate.type);
        const name = clean(candidate.name);
        if (
          !type ||
          candidate === prop ||
          candidate.optional === true ||
          candidate.disabled === true ||
          candidate.readOnly === true ||
          [
            "alert",
            "dir",
            "$.interface.apphook",
            "$.interface.http",
            "$.interface.timer",
            "$.service.db",
          ].includes(type) ||
          configProps.some((configProp) => configProp.name === name) ||
          Object.prototype.hasOwnProperty.call(candidate, "default") ||
          Object.prototype.hasOwnProperty.call(candidate, "static")
        ) {
          return false;
        }
        return true;
      });
      const presented = presentTrigger(app, {
        id,
        name: clean(component.name),
        description: clean(component.description) || null,
        appPropName: clean(prop.name) || null,
        supported: unsupportedProps.length === 0,
        unsupportedReason:
          unsupportedProps.length === 0
            ? null
            : "This event needs configuration Chief does not support yet.",
        configProps,
      });
      const missingPresentedOptions = presented.configProps.some(
        (configProp) => configProp.required && configProp.options.length === 0,
      );
      return {
        ...presented,
        supported: presented.supported && !missingPresentedOptions,
        unsupportedReason: missingPresentedOptions
          ? "This event needs configuration Chief does not support yet."
          : presented.unsupportedReason,
      };
    })
    .filter((component) => component.id && component.name);
}

export async function listPipedreamTriggerComponents(
  userId: string,
  connectionId: string,
): Promise<PipedreamTriggerComponent[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("pipedream_connections")
    .select("app_slug")
    .eq("id", connectionId)
    .eq("user_id", userId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) throw new Error("Pipedream connection not found.");
  const appSlug = data.app_slug as string;
  return (await triggerComponents(userId, appSlug))
    .filter(
      (component) =>
        component.supported &&
        !(
          appSlug === "frontapp" &&
          component.id === "frontapp-new-message-template-created"
        ),
    )
    .map(({ appPropName: _appPropName, ...component }) => component);
}

function configuredTriggerProps(
  component: RuntimeTriggerComponent,
  raw: unknown,
): Record<string, string | string[]> {
  const input = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
  const configured: Record<string, string | string[]> = {};
  for (const prop of component.configProps) {
    const allowed = new Set(prop.options.map((option) => option.value));
    if (prop.multiple) {
      const values = Array.isArray(input[prop.name])
        ? (input[prop.name] as unknown[])
            .map(clean)
            .filter((value) => value && allowed.has(value))
        : [];
      if (prop.required && values.length === 0) {
        throw new Error(`Choose at least one ${prop.label.toLowerCase()}.`);
      }
      if (values.length > 0) configured[prop.name] = [...new Set(values)];
      continue;
    }
    const value = clean(input[prop.name]);
    if (prop.required && !allowed.has(value)) {
      throw new Error(`Choose ${prop.label.toLowerCase()}.`);
    }
    if (allowed.has(value)) configured[prop.name] = value;
  }
  return configured;
}

export async function deployPipedreamTrigger(
  userId: string,
  connectionId: string,
  componentId: string,
  webhookUrl: string,
  rawConfiguredProps?: unknown,
): Promise<{
  id: string;
  app: string;
  name: string | null;
  signingKey: string | null;
}> {
  const supabase = await createClient();
  const { data: connection, error } = await supabase
    .from("pipedream_connections")
    .select("account_id,app_slug")
    .eq("id", connectionId)
    .eq("user_id", userId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!connection) throw new Error("Pipedream connection not found.");

  const component = (await triggerComponents(userId, connection.app_slug as string)).find(
    (candidate) => candidate.id === componentId,
  );
  if (!component) throw new Error("Choose an available Pipedream notification.");
  if (!component.supported) {
    throw new Error(
      component.unsupportedReason ?? "Choose a Pipedream notification Chief can configure.",
    );
  }
  const config = await requireRuntimeConfig(userId);
  const configuredProps: Record<string, unknown> = configuredTriggerProps(
    component,
    rawConfiguredProps,
  );
  const selectedLabels = component.configProps.flatMap((prop) => {
    const configured = configuredProps[prop.name];
    const values = Array.isArray(configured)
      ? configured
      : typeof configured === "string"
        ? [configured]
        : [];
    return prop.options
      .filter((option) => values.includes(option.value))
      .map((option) => option.label);
  });
  if (component.appPropName) {
    configuredProps[component.appPropName] = {
      authProvisionId: connection.account_id as string,
    };
  }
  const response = (await pipedreamFetch(
    config,
    `/connect/${encodeURIComponent(config.projectId)}/triggers/deploy`,
    {
      method: "POST",
      body: {
        id: component.id,
        external_user_id: userId,
        configured_props: configuredProps,
        webhook_url: webhookUrl,
        emit_on_deploy: false,
      },
    },
  )) as { data?: unknown } | null;
  const raw =
    response?.data && typeof response.data === "object"
      ? (response.data as Record<string, unknown>)
      : {};
  const id = clean(raw.id);
  if (!/^dc_[a-zA-Z0-9]+$/.test(id)) {
    throw new Error("Pipedream returned an invalid deployed trigger.");
  }
  const signingKey = clean(raw.webhook_signing_key);
  if (!signingKey) {
    await pipedreamFetch(
      config,
      `/connect/${encodeURIComponent(config.projectId)}/deployed-triggers/${encodeURIComponent(id)}?external_user_id=${encodeURIComponent(userId)}&ignore_hook_errors=true`,
      { method: "DELETE" },
    ).catch(() => {});
    throw new Error("Pipedream did not return a webhook signing key.");
  }
  return {
    id,
    app: connection.app_slug as string,
    name:
      selectedLabels.length > 0
        ? `${component.name}: ${selectedLabels.join(", ")}`
        : clean(raw.name) || component.name || null,
    signingKey,
  };
}

export async function deletePipedreamTrigger(
  userId: string,
  triggerId: string,
): Promise<void> {
  if (!/^dc_[a-zA-Z0-9]+$/.test(triggerId)) {
    throw new Error("Choose a valid Pipedream notification.");
  }
  const config = await requireRuntimeConfig(userId);
  try {
    await pipedreamFetch(
      config,
      `/connect/${encodeURIComponent(config.projectId)}/deployed-triggers/${encodeURIComponent(triggerId)}?external_user_id=${encodeURIComponent(userId)}&ignore_hook_errors=true`,
      { method: "DELETE" },
    );
  } catch (error) {
    // Already absent remotely is the desired delete state.
    if (error instanceof PipedreamRequestError && error.status === 404) return;
    throw error;
  }
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
  const { data: triggers, error: triggerError } = await supabase
    .from("chief_triggers")
    .select("id")
    .eq("connection_id", connectionId);
  if (triggerError) throw new Error(triggerError.message);
  for (const trigger of (triggers ?? []) as Array<{ id: string }>) {
    await deletePipedreamTrigger(userId, trigger.id);
    const { error: deleteTriggerError } = await supabase
      .from("chief_triggers")
      .delete()
      .eq("id", trigger.id)
      .eq("user_id", userId);
    if (deleteTriggerError) throw new Error(deleteTriggerError.message);
  }
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
  return rows.map((row) =>
    buildPipedreamMcpServerConfig({
      mcpUrl: PIPEDREAM_MCP_URL,
      projectId: config.projectId,
      environment: config.environment,
      userId,
      token,
      connection: {
        id: row.id,
        accountId: row.account_id,
        appSlug: row.app_slug,
        appName: row.app_name,
        accountName: row.account_name,
      },
    }),
  );
}

/** First healthy Pipedream connection for an app slug (e.g. `frontapp`). */
export async function findPipedreamConnectionByApp(
  userId: string,
  appSlug: string,
): Promise<PipedreamConnection | null> {
  const slug = clean(appSlug);
  if (!slug) return null;
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("pipedream_connections")
    .select("id,account_id,app_slug,app_name,account_name,healthy")
    .eq("user_id", userId)
    .eq("app_slug", slug)
    .eq("healthy", true)
    .order("created_at", { ascending: true })
    .limit(1)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) return null;
  return toPublic(data as ConnectionRow);
}

export type PipedreamProxyMethod =
  | "GET"
  | "POST"
  | "PUT"
  | "PATCH"
  | "DELETE";

export type PipedreamProxyRequest = {
  accountId: string;
  /** Full upstream URL or app-relative path (see Pipedream Connect proxy docs). */
  url: string;
  method?: PipedreamProxyMethod;
  body?: unknown;
  /** Only `x-pd-proxy-*` headers are forwarded to the upstream API. */
  headers?: Record<string, string>;
};

/** Encode a Connect proxy target the same way @pipedream/sdk does:
 *  standard Base64 (with padding), then the caller must encodeURIComponent
 *  it into the path. Do NOT use base64url — Pipedream rejects those targets. */
export function encodePipedreamProxyTarget(url: string): string {
  return Buffer.from(url, "utf8").toString("base64");
}

/**
 * Call any integrated upstream API through Pipedream Connect Proxy, using the
 * connected account's managed OAuth/API credentials. Use this when a prebuilt
 * MCP action is missing or needs a custom request shape.
 */
export async function pipedreamProxyRequest(
  userId: string,
  request: PipedreamProxyRequest,
): Promise<unknown> {
  const config = await requireRuntimeConfig(userId);
  const accountId = clean(request.accountId);
  if (!/^apn_[a-zA-Z0-9]+$/.test(accountId)) {
    throw new Error("Choose a valid Pipedream connected account.");
  }
  const targetUrl = clean(request.url);
  if (!targetUrl) throw new Error("Enter the upstream API URL.");

  const method = request.method ?? "GET";
  const encodedUrl = encodePipedreamProxyTarget(targetUrl);
  const qs = new URLSearchParams({
    external_user_id: userId,
    account_id: accountId,
  });
  // encodeURIComponent on the Base64 blob matches @pipedream/sdk (padding and
  // "/" in the alphabet must be escaped in the path segment).
  const path = `/connect/${encodeURIComponent(config.projectId)}/proxy/${encodeURIComponent(encodedUrl)}?${qs}`;

  const { token } = await fetchAccessToken(config);
  const headers: Record<string, string> = {
    Authorization: `Bearer ${token}`,
    "x-pd-environment": config.environment,
  };
  if (request.headers) {
    for (const [key, value] of Object.entries(request.headers)) {
      if (key.toLowerCase().startsWith("x-pd-proxy-") && clean(value)) {
        headers[key] = value;
      }
    }
  }
  if (method !== "GET" && method !== "DELETE" && request.body !== undefined) {
    headers["Content-Type"] = "application/json";
  }

  const response = await fetch(`${PIPEDREAM_API}${path}`, {
    method,
    headers,
    ...(request.body !== undefined && method !== "GET" && method !== "DELETE"
      ? { body: JSON.stringify(request.body) }
      : {}),
    cache: "no-store",
    signal: AbortSignal.timeout(25_000),
  });

  if (!response.ok) {
    const detail = (await response.json().catch(() => ({}))) as Record<
      string,
      unknown
    >;
    const reason = proxyFailureReason(detail).slice(0, 240);
    if (response.status === 401 || response.status === 403) {
      throw new PipedreamRequestError(
        reason
          ? `Connect Proxy returned ${response.status} for ${targetUrl}: ${reason}`
          : `Connect Proxy returned ${response.status} for ${targetUrl}. Upstream denied the path or returned an empty body — not necessarily invalid Pipedream project credentials (other proxy paths may still work).`,
        response.status,
      );
    }
    if (response.status === 404) {
      throw new PipedreamRequestError(
        reason
          ? `Pipedream proxy target not found: ${reason}`
          : "Pipedream could not find that project, account, or proxy target.",
        response.status,
      );
    }
    if (response.status === 429) {
      throw new PipedreamRequestError(
        "Pipedream is rate-limiting requests. Try again shortly.",
        response.status,
      );
    }
    throw new PipedreamRequestError(
      reason
        ? `Pipedream proxy rejected that request: ${reason}`
        : `Pipedream proxy request failed (${response.status}).`,
      response.status,
    );
  }
  if (response.status === 204) return null;
  return response.json().catch(() => null);
}

export function publicPipedreamError(error: unknown, fallback: string): string {
  const message = error instanceof Error ? error.message : "";
  if (
    /^(Enter|Choose|Disconnect Pipedream|Finish Pipedream|Pipedream (rejected|could not|did not|returned|is rate-limiting|request failed|proxy)|Connect Proxy returned|Invalid return URL|Stored Pipedream|Pipedream connection not found|Sign in)/.test(
      message,
    )
  ) {
    return message;
  }
  return fallback;
}

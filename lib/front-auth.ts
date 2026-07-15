// OAuth 2.1 + PKCE for Front's official hosted MCP server. The owner supplies
// a confidential Front developer-app client; its secret and every user token
// stay encrypted in Supabase Vault behind service-role-only RPCs.

import {
  discoverOAuthServerInfo,
  exchangeAuthorization,
  refreshAuthorization,
  startAuthorization,
} from "@modelcontextprotocol/sdk/client/auth.js";
import { resourceUrlFromServerUrl } from "@modelcontextprotocol/sdk/shared/auth-utils.js";
import type {
  AuthorizationServerMetadata,
  OAuthClientInformationMixed,
  OAuthTokens,
} from "@modelcontextprotocol/sdk/shared/auth.js";
import {
  FRONT_OAUTH_SCOPE,
  frontOAuthScopeString,
  frontRedirectUri,
  normalizeFrontScopes,
  type FrontOAuthScope,
} from "@/lib/front-oauth-helpers";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";

export const FRONT_MCP_URL = "https://mcp.frontapp.com/mcp";
export {
  FRONT_OAUTH_SCOPE,
  frontOAuthScopeString,
  frontRedirectUri,
  normalizeFrontScopes,
  type FrontOAuthScope,
} from "@/lib/front-oauth-helpers";

type RuntimeConfigRow = {
  client_id: string;
  scopes: string[];
  connected_at: string | null;
  access_token_expires_at: string | null;
  credentials: string;
};

type RuntimeCredentials = {
  clientSecret: string;
  accessToken?: string;
  refreshToken?: string;
  tokenType?: string;
};

type RuntimeConfig = {
  clientId: string;
  clientSecret: string;
  scopes: FrontOAuthScope[];
  connectedAt: string | null;
  accessToken: string | null;
  refreshToken: string | null;
  tokenType: string;
  accessTokenExpiresAt: string | null;
};

export type FrontOAuthStatus = {
  configured: boolean;
  connected: boolean;
  clientId: string | null;
  scopes: FrontOAuthScope[];
  /** True when Front OAuth migrations have not been applied yet. */
  needsMigration?: boolean;
};

function clean(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function parseConfigInput(raw: unknown): {
  clientId: string;
  clientSecret: string;
  scopes: FrontOAuthScope[];
} {
  const body = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
  const clientId = clean(body.clientId);
  const clientSecret = clean(body.clientSecret);
  if (!clientId || clientId.length > 512) {
    throw new Error("Enter the OAuth client ID from your Front developer app.");
  }
  if (!clientSecret || clientSecret.length > 2048) {
    throw new Error("Enter the OAuth client secret from your Front developer app.");
  }
  return {
    clientId,
    clientSecret,
    // Front's AS only accepts feature:mcp. Resource Read/Write/Send live on
    // the Front developer app, not in this OAuth request.
    scopes: [FRONT_OAUTH_SCOPE],
  };
}

async function requireUserId(): Promise<string> {
  const supabase = await createClient();
  const {
    data: { user },
    error,
  } = await supabase.auth.getUser();
  if (error || !user) throw new Error("Sign in to connect Front.");
  return user.id;
}

async function runtimeConfig(userId: string): Promise<RuntimeConfig | null> {
  const admin = createAdminClient();
  const { data, error } = await admin.rpc("chief_front_runtime_config", {
    p_user_id: userId,
  });
  if (error) {
    throw new Error(`Could not resolve Front OAuth credentials: ${error.message}`);
  }
  const row = ((data ?? []) as RuntimeConfigRow[])[0];
  if (!row) return null;

  let credentials: RuntimeCredentials;
  try {
    credentials = JSON.parse(row.credentials) as RuntimeCredentials;
  } catch {
    throw new Error("Stored Front OAuth credentials are invalid.");
  }
  const clientSecret = clean(credentials.clientSecret);
  if (!clientSecret) throw new Error("Stored Front OAuth client secret is missing.");

  return {
    clientId: row.client_id,
    clientSecret,
    scopes: normalizeFrontScopes(row.scopes),
    connectedAt: row.connected_at,
    accessToken: clean(credentials.accessToken) || null,
    refreshToken: clean(credentials.refreshToken) || null,
    tokenType: clean(credentials.tokenType) || "Bearer",
    accessTokenExpiresAt: row.access_token_expires_at,
  };
}

function clientInformation(config: RuntimeConfig): OAuthClientInformationMixed {
  return {
    client_id: config.clientId,
    client_secret: config.clientSecret,
  };
}

async function discoverFrontOAuth(): Promise<{
  authorizationServerUrl: string;
  metadata?: AuthorizationServerMetadata;
  resource: URL;
}> {
  const discovered = await discoverOAuthServerInfo(FRONT_MCP_URL);
  // Front's protected-resource metadata advertises https://mcp.frontapp.com
  // (no /mcp path). Prefer that over deriving the resource from the MCP URL.
  const advertised = clean(discovered.resourceMetadata?.resource);
  return {
    authorizationServerUrl: discovered.authorizationServerUrl,
    metadata: discovered.authorizationServerMetadata,
    resource: advertised
      ? new URL(advertised)
      : resourceUrlFromServerUrl(FRONT_MCP_URL),
  };
}

function expiry(tokens: OAuthTokens): string {
  const seconds =
    typeof tokens.expires_in === "number" && tokens.expires_in > 0
      ? tokens.expires_in
      : 3600;
  return new Date(Date.now() + Math.max(30, seconds - 60) * 1000).toISOString();
}

async function storeTokens(
  userId: string,
  previous: RuntimeConfig,
  tokens: OAuthTokens,
): Promise<void> {
  const accessToken = clean(tokens.access_token);
  const refreshToken = clean(tokens.refresh_token) || previous.refreshToken;
  if (!accessToken || !refreshToken) {
    throw new Error(
      "Front did not return a durable OAuth grant. Disconnect the app in Front and connect again.",
    );
  }
  const admin = createAdminClient();
  const { error } = await admin.rpc("chief_front_store_tokens", {
    p_user_id: userId,
    p_token_payload: JSON.stringify({
      accessToken,
      refreshToken,
      tokenType: clean(tokens.token_type) || "Bearer",
    }),
    p_expires_at: expiry(tokens),
    p_scopes: previous.scopes,
  });
  if (error) throw new Error(`Could not store the Front OAuth grant: ${error.message}`);
}

export async function getFrontOAuthStatus(): Promise<FrontOAuthStatus> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("front_oauth_config")
    .select("client_id, scopes, connected_at")
    .maybeSingle();
  if (error) {
    // Pending Front migration — treat as unconfigured so the Connections
    // card can offer "Apply database update" instead of a hard failure.
    if (isFrontSchemaMissing(error.message)) {
      return {
        configured: false,
        connected: false,
        clientId: null,
        scopes: [],
        needsMigration: true,
      };
    }
    throw new Error(error.message);
  }
  if (!data) {
    return { configured: false, connected: false, clientId: null, scopes: [] };
  }
  return {
    configured: true,
    connected: Boolean(data.connected_at),
    clientId: data.client_id,
    scopes: normalizeFrontScopes(data.scopes),
  };
}

export async function saveFrontOAuthConfig(
  userId: string,
  raw: unknown,
): Promise<FrontOAuthStatus> {
  const input = parseConfigInput(raw);
  const admin = createAdminClient();

  const upsert = (scopes: FrontOAuthScope[] | string[]) =>
    admin.rpc("chief_front_upsert_config", {
      p_user_id: userId,
      p_client_id: input.clientId,
      p_client_secret: input.clientSecret,
      p_scopes: scopes,
    });

  let { error } = await upsert(input.scopes);
  let migrateNote = "";

  // Deployed app can ship Front SQL before the owner runs /api/setup/migrate.
  // Also covers the first Front RPC that only allowed read/write/send.
  if (error && isFrontSchemaDrift(error.message)) {
    const priorMessage = error.message;
    try {
      const { runMigrations } = await import("@/lib/setup");
      const applied = await runMigrations();
      if (applied.length > 0) {
        migrateNote = ` Applied ${applied.length} pending migration(s).`;
      }
      ({ error } = await upsert([FRONT_OAUTH_SCOPE]));
    } catch (migrateError) {
      const detail =
        migrateError instanceof Error ? migrateError.message : String(migrateError);
      throw new Error(
        `Could not save Front OAuth setup: ${priorMessage}. ` +
          `Tried to apply pending migrations and failed: ${detail} ` +
          `Open Connections and use “Apply database update”, or POST /api/setup/migrate while signed in.`,
      );
    }
  }

  // Last-resort compatibility: old RPC accepts "read", while OAuth always
  // requests feature:mcp from buildFrontAuthorization.
  if (error && /scopes|feature:mcp|read, write, or send/i.test(error.message)) {
    ({ error } = await upsert(["read"]));
  }

  if (error) {
    throw new Error(
      `Could not save Front OAuth setup: ${error.message}.${migrateNote}`.trim(),
    );
  }
  return {
    configured: true,
    connected: false,
    clientId: input.clientId,
    scopes: [FRONT_OAUTH_SCOPE],
  };
}

/** Table / RPC from the Front OAuth migrations is not in this database yet. */
export function isFrontSchemaMissing(message: string): boolean {
  return /chief_front_|front_oauth|does not exist|schema cache|Could not find the (table|function)/i.test(
    message,
  );
}

function isFrontSchemaDrift(message: string): boolean {
  return (
    isFrontSchemaMissing(message) ||
    /scopes|feature:mcp|read, write, or send|migration/i.test(message)
  );
}

export async function buildFrontAuthorization(
  userId: string,
  origin: string,
  state: string,
): Promise<{ authorizationUrl: URL; codeVerifier: string }> {
  const config = await runtimeConfig(userId);
  if (!config) {
    throw new Error("Save your Front developer-app credentials first.");
  }
  const discovered = await discoverFrontOAuth();
  return startAuthorization(discovered.authorizationServerUrl, {
    metadata: discovered.metadata,
    clientInformation: clientInformation(config),
    redirectUrl: frontRedirectUri(origin),
    scope: frontOAuthScopeString(),
    state,
    resource: discovered.resource,
  });
}

export async function exchangeFrontCodeAndStore(
  userId: string,
  origin: string,
  code: string,
  codeVerifier: string,
): Promise<void> {
  const config = await runtimeConfig(userId);
  if (!config) throw new Error("Front OAuth setup was removed.");
  const discovered = await discoverFrontOAuth();
  const tokens = await exchangeAuthorization(discovered.authorizationServerUrl, {
    metadata: discovered.metadata,
    clientInformation: clientInformation(config),
    authorizationCode: code,
    codeVerifier,
    redirectUri: frontRedirectUri(origin),
    resource: discovered.resource,
  });
  await storeTokens(userId, config, tokens);
}

/** Return a valid user token for Front's MCP server, refreshing when needed. */
export async function getFrontAccessToken(): Promise<string | null> {
  const userId = await requireUserId();
  const config = await runtimeConfig(userId);
  if (!config?.connectedAt || !config.refreshToken) return null;

  const expiresAt = config.accessTokenExpiresAt
    ? Date.parse(config.accessTokenExpiresAt)
    : 0;
  if (config.accessToken && expiresAt > Date.now() + 30_000) {
    return config.accessToken;
  }

  try {
    const discovered = await discoverFrontOAuth();
    const tokens = await refreshAuthorization(discovered.authorizationServerUrl, {
      metadata: discovered.metadata,
      clientInformation: clientInformation(config),
      refreshToken: config.refreshToken,
      resource: discovered.resource,
    });
    await storeTokens(userId, config, tokens);
    return tokens.access_token;
  } catch {
    throw new Error("Front authorization expired or was revoked. Reconnect Front.");
  }
}

export async function deleteFrontOAuthConfig(userId: string): Promise<void> {
  const config = await runtimeConfig(userId);
  if (config?.refreshToken) {
    try {
      const discovered = await discoverFrontOAuth();
      const endpoint = clean(
        (
          discovered.metadata as
            | (AuthorizationServerMetadata & { revocation_endpoint?: string })
            | undefined
        )?.revocation_endpoint,
      );
      if (endpoint) {
        await fetch(endpoint, {
          method: "POST",
          headers: {
            Authorization: `Basic ${Buffer.from(
              `${config.clientId}:${config.clientSecret}`,
              "utf8",
            ).toString("base64")}`,
            "Content-Type": "application/x-www-form-urlencoded",
          },
          body: new URLSearchParams({
            token: config.refreshToken,
            token_type_hint: "refresh_token",
          }),
          signal: AbortSignal.timeout(10_000),
        });
      }
    } catch {
      // Revocation is best-effort; local deletion must still succeed.
    }
  }
  const admin = createAdminClient();
  const { error } = await admin.rpc("chief_front_delete_config", {
    p_user_id: userId,
  });
  if (error) throw new Error(`Could not remove Front OAuth setup: ${error.message}`);
}

export function publicFrontOAuthError(
  error: unknown,
  fallback = "Front connection failed.",
): string {
  const message = error instanceof Error ? error.message.trim() : "";
  return message ? message.slice(0, 400) : fallback;
}

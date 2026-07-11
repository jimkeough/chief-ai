import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import type { McpServerConfig } from "@/lib/mcp";
import { saveAppSettings } from "@/lib/settings";
import { validateMcpUrl } from "@/lib/mcp-url";

export type McpConnection = {
  id: string;
  name: string;
  url: string;
  authType: "none" | "bearer";
  hasSecret: boolean;
  app: string | null;
  allowedTools: string[];
  trustReadAnnotations: boolean;
  createdAt: string;
  updatedAt: string;
};

export type McpConnectionInput = {
  name: string;
  url: string;
  authType: "none" | "bearer";
  authorizationToken?: string;
  clearAuthorizationToken?: boolean;
  app?: string | null;
  allowedTools?: string[];
  trustReadAnnotations?: boolean;
};

type ConnectionRow = {
  id: string;
  user_id: string;
  name: string;
  url: string;
  auth_type: "none" | "bearer";
  app: string | null;
  allowed_tools: string[] | null;
  trust_read_annotations: boolean;
  created_at: string;
  updated_at: string;
};

type RuntimeSecret = {
  connection_id: string;
  authorization_token: string;
};

const COLUMNS =
  "id,user_id,name,url,auth_type,app,allowed_tools,trust_read_annotations,created_at,updated_at";

async function getRuntimeSecrets(
  ids: string[],
  userId: string,
): Promise<Map<string, string>> {
  if (ids.length === 0) return new Map();
  const admin = createAdminClient();
  const { data, error } = await admin.rpc("chief_mcp_runtime_secrets", {
    p_connection_ids: ids,
    p_user_id: userId,
  });
  if (error) throw new Error(`Could not resolve MCP credentials: ${error.message}`);
  return new Map(
    ((data ?? []) as RuntimeSecret[]).map((row) => [
      row.connection_id,
      row.authorization_token,
    ]),
  );
}

async function listRows(): Promise<ConnectionRow[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("mcp_connections")
    .select(COLUMNS)
    .order("created_at", { ascending: true });
  if (error) throw new Error(error.message);
  return (data ?? []) as ConnectionRow[];
}

function toPublic(row: ConnectionRow, secrets: Map<string, string>): McpConnection {
  return {
    id: row.id,
    name: row.name,
    url: row.url,
    authType: row.auth_type,
    hasSecret: secrets.has(row.id),
    app: row.app,
    allowedTools: row.allowed_tools ?? [],
    trustReadAnnotations: row.trust_read_annotations,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export async function listMcpConnections(): Promise<McpConnection[]> {
  const rows = await listRows();
  const secrets = await getRuntimeSecrets(
    rows.map((row) => row.id),
    rows[0]?.user_id ?? "",
  );
  return rows.map((row) => toPublic(row, secrets));
}

export async function getRuntimeMcpConnections(): Promise<McpServerConfig[]> {
  const rows = await listRows();
  const secrets = await getRuntimeSecrets(
    rows.map((row) => row.id),
    rows[0]?.user_id ?? "",
  );
  return rows.map((row) => {
    const token = row.auth_type === "bearer" ? secrets.get(row.id) : undefined;
    return {
      id: row.id,
      name: row.name,
      url: row.url,
      ...(token ? { authorization_token: token } : {}),
      ...(row.allowed_tools?.length ? { allowedTools: row.allowed_tools } : {}),
      ...(row.app ? { app: row.app } : {}),
      trustAnnotations: row.trust_read_annotations,
    };
  });
}

export async function getRuntimeMcpConnection(
  connectionId: string,
): Promise<McpServerConfig | null> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("mcp_connections")
    .select(COLUMNS)
    .eq("id", connectionId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) return null;
  const row = data as ConnectionRow;
  const secrets = await getRuntimeSecrets([row.id], row.user_id);
  const token = row.auth_type === "bearer" ? secrets.get(row.id) : undefined;
  return {
    id: row.id,
    name: row.name,
    url: row.url,
    ...(token ? { authorization_token: token } : {}),
    ...(row.allowed_tools?.length ? { allowedTools: row.allowed_tools } : {}),
    ...(row.app ? { app: row.app } : {}),
    trustAnnotations: row.trust_read_annotations,
  };
}

async function setSecret(
  connectionId: string,
  userId: string,
  secret: string,
): Promise<void> {
  const admin = createAdminClient();
  const { error } = await admin.rpc("chief_mcp_set_secret", {
    p_connection_id: connectionId,
    p_user_id: userId,
    p_secret: secret,
  });
  if (error) throw new Error(`Could not store MCP credential: ${error.message}`);
}

export async function createMcpConnection(
  userId: string,
  input: McpConnectionInput,
): Promise<McpConnection> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("mcp_connections")
    .insert({
      user_id: userId,
      name: input.name,
      url: input.url,
      auth_type: input.authType,
      app: input.app || null,
      allowed_tools: input.allowedTools?.length ? input.allowedTools : null,
      trust_read_annotations: input.trustReadAnnotations === true,
    })
    .select(COLUMNS)
    .single();
  if (error) throw new Error(error.message);

  const row = data as ConnectionRow;
  try {
    if (input.authType === "bearer" && input.authorizationToken) {
      await setSecret(row.id, userId, input.authorizationToken);
    }
  } catch (secretError) {
    await supabase.from("mcp_connections").delete().eq("id", row.id);
    throw secretError;
  }

  const secrets = await getRuntimeSecrets([row.id], userId);
  return toPublic(row, secrets);
}

export async function updateMcpConnection(
  userId: string,
  connectionId: string,
  input: McpConnectionInput,
): Promise<McpConnection> {
  const supabase = await createClient();
  const { data: existing, error: existingError } = await supabase
    .from("mcp_connections")
    .select("id")
    .eq("id", connectionId)
    .maybeSingle();
  if (existingError) throw new Error(existingError.message);
  if (!existing) throw new Error("MCP connection not found.");

  const admin = createAdminClient();
  const { error: updateError } = await admin.rpc("chief_mcp_update_connection", {
    p_connection_id: connectionId,
    p_user_id: userId,
    p_name: input.name,
    p_url: input.url,
    p_auth_type: input.authType,
    p_app: input.app || "",
    p_allowed_tools: input.allowedTools?.length ? input.allowedTools : null,
    p_trust_read_annotations: input.trustReadAnnotations === true,
    p_secret: input.authorizationToken || null,
    p_clear_secret:
      input.clearAuthorizationToken === true || input.authType === "none",
  });
  if (updateError) throw new Error(updateError.message);

  const { data, error } = await supabase
    .from("mcp_connections")
    .select(COLUMNS)
    .eq("id", connectionId)
    .single();
  if (error) throw new Error(error.message);

  const row = data as ConnectionRow;
  const secrets = await getRuntimeSecrets([row.id], userId);
  return toPublic(row, secrets);
}

export async function deleteMcpConnection(connectionId: string): Promise<void> {
  const supabase = await createClient();
  const { error } = await supabase
    .from("mcp_connections")
    .delete()
    .eq("id", connectionId);
  if (error) throw new Error(error.message);
}

function legacyServerJson(server: McpServerConfig): Record<string, unknown> {
  return {
    name: server.name,
    url: server.url,
    ...(server.authorization_token
      ? { authorization_token: server.authorization_token }
      : {}),
    ...(server.allowedTools?.length ? { allowedTools: server.allowedTools } : {}),
    ...(server.app ? { app: server.app } : {}),
    ...(server.accountLabel ? { accountLabel: server.accountLabel } : {}),
    ...(server.toolPrefix ? { toolPrefix: server.toolPrefix } : {}),
  };
}

export async function migrateLegacyMcpConnections(
  userId: string,
  legacy: McpServerConfig[],
): Promise<{ imported: number; remaining: McpServerConfig[]; errors: string[] }> {
  const current = await listMcpConnections();
  const byName = new Map(
    current.map((connection) => [connection.name.toLowerCase(), connection]),
  );
  const remaining: McpServerConfig[] = [];
  const errors: string[] = [];
  let imported = 0;

  for (const server of legacy) {
    try {
      const existing = byName.get(server.name.toLowerCase());
      const url = (await validateMcpUrl(server.url)).href;
      const input: McpConnectionInput = {
        name: server.name,
        url,
        authType: server.authorization_token ? "bearer" : "none",
        ...(server.authorization_token
          ? { authorizationToken: server.authorization_token }
          : {}),
        app: server.app ?? null,
        allowedTools: server.allowedTools ?? [],
        trustReadAnnotations: true,
      };
      if (existing) {
        if (server.authorization_token && !existing.hasSecret) {
          await updateMcpConnection(userId, existing.id, input);
          imported++;
        }
        continue;
      }
      const created = await createMcpConnection(userId, input);
      byName.set(created.name.toLowerCase(), created);
      imported++;
    } catch (error) {
      remaining.push(server);
      errors.push(error instanceof Error ? error.message : "Migration failed.");
    }
  }

  await saveAppSettings(
    {
      "mcp.servers": remaining.length
        ? JSON.stringify(remaining.map(legacyServerJson))
        : "",
    },
    userId,
  );
  return { imported, remaining, errors };
}


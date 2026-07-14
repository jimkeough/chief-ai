import type { McpServerConfig } from "./mcp";

export const PIPEDREAM_MCP_REGISTRY = "all" as const;

type PipedreamMcpConnection = {
  id: string;
  accountId: string;
  appSlug: string;
  appName: string;
  accountName: string | null;
};

export function buildPipedreamMcpServerConfig(input: {
  mcpUrl: string;
  projectId: string;
  environment: "development" | "production";
  userId: string;
  token: string;
  connection: PipedreamMcpConnection;
}): McpServerConfig {
  const { connection } = input;
  const safeApp = connection.appSlug
    .replace(/[^a-zA-Z0-9_]/g, "_")
    .slice(0, 12);
  return {
    id: connection.id,
    name: `pipedream:${connection.id}`,
    url: input.mcpUrl,
    authorization_token: input.token,
    headers: {
      "x-pd-project-id": input.projectId,
      "x-pd-environment": input.environment,
      "x-pd-external-user-id": input.userId,
      "x-pd-app-slug": connection.appSlug,
      "x-pd-account-id": connection.accountId,
      "x-pd-registry": PIPEDREAM_MCP_REGISTRY,
    },
    app: connection.appName,
    accountLabel: connection.accountName ?? connection.accountId,
    toolPrefix: `pd_${safeApp}_${connection.id.slice(0, 4)}_`,
    trustAnnotations: true,
  };
}

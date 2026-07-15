// Built-in adapter for Front's official hosted MCP server. The OAuth token is
// minted from the owner's Front developer app and refreshed per request.

import type { McpServerConfig } from "@/lib/mcp";
import { FRONT_MCP_URL, getFrontAccessToken } from "@/lib/front-auth";

export function isFrontServer(server: McpServerConfig): boolean {
  const app = (server.app ?? "").toLowerCase().replace(/[^a-z0-9]/g, "");
  if (app === "front" || app === "frontapp") return true;
  try {
    if (new URL(server.url).hostname.toLowerCase() === "mcp.frontapp.com") {
      return true;
    }
  } catch {
    // URL validation happens before a configured server reaches the broker.
  }
  return /(?:^|[^a-z0-9])front(?:app)?(?:$|[^a-z0-9])/i.test(server.name);
}

export async function frontMcpServer(): Promise<McpServerConfig | null> {
  const token = await getFrontAccessToken();
  if (!token) return null;
  return {
    name: "front",
    app: "frontapp",
    url: FRONT_MCP_URL,
    authorization_token: token,
    // Front documents read annotations and marks every user-visible mutation
    // destructive. Chief still forces every non-read tool through approval.
    trustAnnotations: true,
  };
}

import { McpUrlError } from "@/lib/mcp-url";

const SAFE_INPUT_ERROR =
  /^(Connection details|Name must|Enter a valid|MCP servers must|Put credentials|MCP server URLs|Public MCP servers|Private or reserved|Private network|Credential is|Enter the bearer token|App slug|Allowed tool|Limit the connection)/;

export function publicMcpError(
  error: unknown,
  fallback: string,
): string {
  const message = error instanceof Error ? error.message : "";
  if (error instanceof McpUrlError || SAFE_INPUT_ERROR.test(message)) return message;
  if (/duplicate key|unique constraint/i.test(message)) {
    return "A connection with that name already exists.";
  }
  if (/not found/i.test(message)) return "MCP connection not found.";
  if (/401|403|unauthori[sz]ed|forbidden|invalid bearer|invalid token/i.test(message)) {
    return "The MCP server rejected the connection. Check its credential.";
  }
  if (/timeout|timed out|fetch failed|ENOTFOUND|ECONN|Streamable HTTP/i.test(message)) {
    return "Could not reach the MCP server. Check its URL and availability.";
  }
  return fallback;
}


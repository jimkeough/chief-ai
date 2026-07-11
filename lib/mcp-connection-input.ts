import { parseMcpUrl, validateMcpUrl } from "@/lib/mcp-url";
import type { McpConnectionInput } from "@/lib/mcp-connections";

const NAME_RE = /^[a-zA-Z0-9_-]{1,64}$/;
const APP_RE = /^[a-zA-Z0-9_-]{1,64}$/;
const TOOL_RE = /^[a-zA-Z0-9_-]{1,64}$/;

export async function parseMcpConnectionInput(
  value: unknown,
  options?: { allowExistingBearerSecret?: boolean },
): Promise<McpConnectionInput> {
  if (!value || typeof value !== "object") {
    throw new Error("Connection details are required.");
  }
  const input = value as Record<string, unknown>;
  const name = typeof input.name === "string" ? input.name.trim() : "";
  if (!NAME_RE.test(name)) {
    throw new Error("Name must use 1–64 letters, numbers, dashes, or underscores.");
  }

  const rawUrl = typeof input.url === "string" ? input.url.trim() : "";
  parseMcpUrl(rawUrl);
  const url = (await validateMcpUrl(rawUrl)).href;

  const authType = input.authType === "bearer" ? "bearer" : "none";
  const authorizationToken =
    typeof input.authorizationToken === "string"
      ? input.authorizationToken.trim()
      : "";
  if (authorizationToken.length > 8192) {
    throw new Error("Credential is too long.");
  }
  if (
    authType === "bearer" &&
    !authorizationToken &&
    !options?.allowExistingBearerSecret
  ) {
    throw new Error("Enter the bearer token for this connection.");
  }

  const app = typeof input.app === "string" ? input.app.trim() : "";
  if (app && !APP_RE.test(app)) {
    throw new Error("App slug must use letters, numbers, dashes, or underscores.");
  }

  const allowedTools = Array.isArray(input.allowedTools)
    ? [
        ...new Set(
          input.allowedTools
            .filter((tool): tool is string => typeof tool === "string")
            .map((tool) => tool.trim())
            .filter(Boolean),
        ),
      ]
    : [];
  if (allowedTools.some((tool) => !TOOL_RE.test(tool))) {
    throw new Error("Allowed tool names may only contain letters, numbers, dashes, or underscores.");
  }
  if (allowedTools.length > 150) {
    throw new Error("Limit the connection to 150 allowed tools.");
  }

  return {
    name,
    url,
    authType,
    ...(authorizationToken ? { authorizationToken } : {}),
    clearAuthorizationToken: input.clearAuthorizationToken === true,
    app: app || null,
    allowedTools,
    trustReadAnnotations: input.trustReadAnnotations === true,
  };
}


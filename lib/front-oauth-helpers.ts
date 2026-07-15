// Front's authorization server advertises only one OAuth scope for MCP:
// `feature:mcp`. The Front developer app's Resource permissions (Read /
// Write / Send) control what that grant can do — they are not OAuth scopes.

export const FRONT_OAUTH_SCOPE = "feature:mcp" as const;
export type FrontOAuthScope = typeof FRONT_OAUTH_SCOPE;

const clean = (value: unknown): string =>
  typeof value === "string" ? value.trim() : "";

/** Normalize stored scopes to Front's only supported MCP OAuth scope. */
export function normalizeFrontScopes(value: unknown): FrontOAuthScope[] {
  const raw = Array.isArray(value)
    ? value.map(clean)
    : clean(value)
      ? [clean(value)]
      : [];
  // Accept legacy values written before we learned Front only supports
  // feature:mcp, then coerce everything to the real scope.
  if (
    raw.length === 0 ||
    raw.includes(FRONT_OAUTH_SCOPE) ||
    raw.some((scope) => ["read", "write", "send"].includes(scope))
  ) {
    return [FRONT_OAUTH_SCOPE];
  }
  throw new Error(
    `Front MCP OAuth only supports the "${FRONT_OAUTH_SCOPE}" scope.`,
  );
}

export function frontOAuthScopeString(): string {
  return FRONT_OAUTH_SCOPE;
}

export function frontRedirectUri(origin: string): string {
  return `${origin.replace(/\/$/, "")}/api/front/callback`;
}

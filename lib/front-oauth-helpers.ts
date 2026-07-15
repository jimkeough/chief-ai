export const FRONT_OAUTH_SCOPES = ["read", "write", "send"] as const;
export type FrontOAuthScope = (typeof FRONT_OAUTH_SCOPES)[number];

const clean = (value: unknown): string =>
  typeof value === "string" ? value.trim() : "";

export function normalizeFrontScopes(value: unknown): FrontOAuthScope[] {
  const raw = Array.isArray(value) ? value : [];
  const selected = new Set(
    raw
      .map(clean)
      .filter((scope): scope is FrontOAuthScope =>
        (FRONT_OAUTH_SCOPES as readonly string[]).includes(scope),
      ),
  );
  if (!selected.has("read")) {
    throw new Error("Front MCP requires the read scope.");
  }
  return FRONT_OAUTH_SCOPES.filter((scope) => selected.has(scope));
}

export function frontRedirectUri(origin: string): string {
  return `${origin.replace(/\/$/, "")}/api/front/callback`;
}

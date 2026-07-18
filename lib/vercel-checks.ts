// Route-health checks for a Vercel deployment/preview — the "hit key routes and
// report status + response timing" piece of Chief's dev loop (DEVLOOP-PLAN.md
// §4). Read-only: GET requests only, constrained to Vercel-hosted origins so it
// can never be aimed at localhost, an internal IP, or a cloud metadata endpoint.
//
// Deployment status, build logs, and runtime errors come from the connected
// Vercel MCP (auto-running reads). This tool covers the one thing that MCP
// can't — probing arbitrary routes for status + latency — including the Vercel
// automation bypass header for protected previews. The bypass secret is read
// server-side from settings and never enters model context.

import { performance } from "node:perf_hooks";

export type RouteCheck = {
  path: string;
  url: string;
  status: number | null;
  ok: boolean;
  redirected: boolean;
  ttfbMs: number | null;
  totalMs: number | null;
  bytes: number | null;
  truncated: boolean;
  error: string | null;
};

const MAX_PATHS = 10;
const MAX_BODY_BYTES = 256 * 1024;
const REQUEST_TIMEOUT_MS = 12_000;

/** Validate + normalize the deployment base URL. Only https Vercel origins are
 *  allowed (previews are *.vercel.app), so a route check can't be pointed at
 *  localhost, internal IPs, or a metadata endpoint. Returns the origin or an
 *  error string. */
export function normalizeVercelBase(
  raw: string,
): { origin: string } | { error: string } {
  let u: URL;
  try {
    u = new URL(raw.trim());
  } catch {
    return { error: `Not a valid URL: ${raw}` };
  }
  if (u.protocol !== "https:") return { error: "URL must be https." };
  const host = u.hostname.toLowerCase();
  if (host !== "vercel.app" && !host.endsWith(".vercel.app"))
    return {
      error: `Only Vercel hosts (*.vercel.app) are allowed, got ${host}.`,
    };
  if (host === "vercel.app")
    return {
      error:
        "Provide a deployment host (e.g. my-app-git-branch.vercel.app), not vercel.app.",
    };
  return { origin: u.origin };
}

/** Clean the requested paths: default to ["/"], ensure a leading slash, drop
 *  blanks, de-dup, and cap the count. */
export function normalizePaths(paths: unknown): string[] {
  const arr = Array.isArray(paths)
    ? paths.map((p) => (typeof p === "string" ? p.trim() : "")).filter(Boolean)
    : [];
  const cleaned = (arr.length ? arr : ["/"]).map((p) =>
    p.startsWith("/") ? p : `/${p}`,
  );
  const seen = new Set<string>();
  const out: string[] = [];
  for (const p of cleaned) {
    if (seen.has(p)) continue;
    seen.add(p);
    out.push(p);
    if (out.length >= MAX_PATHS) break;
  }
  return out;
}

async function checkOne(
  origin: string,
  path: string,
  secret: string | null,
): Promise<RouteCheck> {
  const url = `${origin}${path}`;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  const headers: Record<string, string> = {};
  if (secret) headers["x-vercel-protection-bypass"] = secret;
  const start = performance.now();
  try {
    const res = await fetch(url, {
      method: "GET",
      headers,
      redirect: "follow",
      signal: controller.signal,
    });
    const ttfbMs = Math.round(performance.now() - start);
    // Consume the body (bounded) so "total" reflects a full response without
    // downloading something huge.
    let bytes = 0;
    let truncated = false;
    const reader = res.body?.getReader();
    if (reader) {
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        bytes += value?.byteLength ?? 0;
        if (bytes >= MAX_BODY_BYTES) {
          truncated = true;
          await reader.cancel();
          break;
        }
      }
    }
    const totalMs = Math.round(performance.now() - start);
    return {
      path,
      url,
      status: res.status,
      ok: res.ok,
      redirected: res.redirected,
      ttfbMs,
      totalMs,
      bytes,
      truncated,
      error: null,
    };
  } catch (e) {
    const msg =
      e instanceof Error && e.name === "AbortError"
        ? `timed out after ${REQUEST_TIMEOUT_MS} ms`
        : e instanceof Error
          ? e.message
          : "request failed";
    return {
      path,
      url,
      status: null,
      ok: false,
      redirected: false,
      ttfbMs: null,
      totalMs: null,
      bytes: null,
      truncated: false,
      error: msg,
    };
  } finally {
    clearTimeout(timer);
  }
}

/** Probe each route sequentially (small N; keeps ordering and doesn't hammer a
 *  cold preview). */
export async function checkRoutes(input: {
  base: string;
  paths?: unknown;
  secret?: string | null;
}): Promise<{ origin: string; results: RouteCheck[] } | { error: string }> {
  const norm = normalizeVercelBase(input.base);
  if ("error" in norm) return norm;
  const paths = normalizePaths(input.paths);
  const results: RouteCheck[] = [];
  for (const p of paths) {
    results.push(await checkOne(norm.origin, p, input.secret ?? null));
  }
  return { origin: norm.origin, results };
}

const kb = (bytes: number | null): string =>
  `${Math.max(0, Math.round((bytes ?? 0) / 1024))}KB`;

/** Compact, model-readable summary of the checks. */
export function formatRouteChecks(
  origin: string,
  results: RouteCheck[],
): string {
  const lines = results.map((r) => {
    if (r.error) return `✗ ${r.path} — ${r.error}`;
    const flag = r.ok ? "✓" : "✗";
    const redir = r.redirected ? " (redirected)" : "";
    const size = r.truncated ? `≥${kb(r.bytes)}` : kb(r.bytes);
    return `${flag} ${r.path} — ${r.status}${redir} · TTFB ${r.ttfbMs}ms · total ${r.totalMs}ms · ${size}`;
  });
  return `Route checks on ${origin}:\n${lines.join("\n")}`;
}

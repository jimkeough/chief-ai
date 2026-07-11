import dns from "node:dns/promises";
import net from "node:net";

export class McpUrlError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "McpUrlError";
  }
}

function normalizedHost(hostname: string): string {
  return hostname.toLowerCase().replace(/^\[|\]$/g, "").replace(/\.$/, "");
}

function isBlockedIpv4(address: string): boolean {
  const parts = address.split(".").map(Number);
  if (parts.length !== 4 || parts.some((part) => !Number.isInteger(part))) return true;
  const [a, b, c] = parts;
  return (
    a === 0 ||
    a === 10 ||
    a === 127 ||
    (a === 100 && b >= 64 && b <= 127) ||
    (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 0 && c === 0) ||
    (a === 192 && b === 0 && c === 2) ||
    (a === 192 && b === 168) ||
    (a === 198 && (b === 18 || b === 19)) ||
    (a === 198 && b === 51 && c === 100) ||
    (a === 203 && b === 0 && c === 113) ||
    a >= 224
  );
}

function isBlockedIp(address: string): boolean {
  const host = normalizedHost(address);
  if (net.isIPv4(host)) return isBlockedIpv4(host);
  if (!net.isIPv6(host)) return true;

  const lower = host.toLowerCase();
  const mapped = lower.match(/^(?:::ffff:)(\d+\.\d+\.\d+\.\d+)$/);
  if (mapped) return isBlockedIpv4(mapped[1]);
  return (
    lower === "::" ||
    lower === "::1" ||
    lower.startsWith("fc") ||
    lower.startsWith("fd") ||
    lower.startsWith("fe8") ||
    lower.startsWith("fe9") ||
    lower.startsWith("fea") ||
    lower.startsWith("feb") ||
    lower.startsWith("ff") ||
    lower.startsWith("2001:db8:")
  );
}

function isLocalDevelopmentHost(hostname: string): boolean {
  const host = normalizedHost(hostname);
  return host === "localhost" || host === "127.0.0.1" || host === "::1";
}

/** Parse and apply checks that do not require network access. */
export function parseMcpUrl(raw: string): URL {
  let url: URL;
  try {
    url = new URL(raw.trim());
  } catch {
    throw new McpUrlError("Enter a valid MCP server URL.");
  }

  const localDevelopment =
    process.env.NODE_ENV !== "production" && isLocalDevelopmentHost(url.hostname);
  if (url.protocol !== "https:" && !(url.protocol === "http:" && localDevelopment)) {
    throw new McpUrlError("MCP servers must use HTTPS.");
  }
  if (url.username || url.password) {
    throw new McpUrlError("Put credentials in the secret field, not the URL.");
  }
  if (url.hash) throw new McpUrlError("MCP server URLs cannot include fragments.");
  if (!localDevelopment && url.port && url.port !== "443") {
    throw new McpUrlError("Public MCP servers must use the standard HTTPS port.");
  }

  const host = normalizedHost(url.hostname);
  if (
    host === "metadata.google.internal" ||
    host.endsWith(".internal") ||
    host.endsWith(".local")
  ) {
    throw new McpUrlError("Private network hosts are not allowed.");
  }
  if (net.isIP(host) && isBlockedIp(host) && !localDevelopment) {
    throw new McpUrlError("Private or reserved network addresses are not allowed.");
  }
  return url;
}

/** Resolve immediately before connecting to reduce DNS-rebinding/SSRF risk. */
export async function validateMcpUrl(raw: string): Promise<URL> {
  const url = parseMcpUrl(raw);
  if (process.env.NODE_ENV !== "production" && isLocalDevelopmentHost(url.hostname)) {
    return url;
  }

  const host = normalizedHost(url.hostname);
  if (net.isIP(host)) return url;
  const addresses = await dns.lookup(host, { all: true, verbatim: true });
  if (addresses.length === 0) throw new McpUrlError("MCP server host did not resolve.");
  if (addresses.some(({ address }) => isBlockedIp(address))) {
    throw new McpUrlError("MCP server resolves to a private or reserved address.");
  }
  return url;
}

export async function safeMcpFetch(
  input: string | URL | Request,
  init?: RequestInit,
): Promise<Response> {
  const raw =
    input instanceof Request ? input.url : input instanceof URL ? input.href : input;
  await validateMcpUrl(raw);
  const timeoutSignal = AbortSignal.timeout(10_000);
  const signal = init?.signal
    ? AbortSignal.any([init.signal, timeoutSignal])
    : timeoutSignal;
  const response = await fetch(input, {
    ...init,
    redirect: "manual",
    signal,
  });
  if (response.status >= 300 && response.status < 400) {
    throw new McpUrlError("MCP server redirects are not allowed.");
  }
  return response;
}


// Shared plumbing for the Chief Connect service: customer-key auth and raw
// Pipedream Connect REST calls (no SDK — four endpoints, zero dependencies).

const PD_API = "https://api.pipedream.com/v1";

/** Parse CONNECT_KEYS ("key:externalUserId,key2:user2") into a Map. */
function keyTable() {
  const table = new Map();
  for (const pair of (process.env.CONNECT_KEYS ?? "").split(",")) {
    const [key, user] = pair.split(":").map((s) => s?.trim());
    if (key && user) table.set(key, user);
  }
  return table;
}

/** Resolve the caller's externalUserId from their bearer key, or null. */
export function authenticate(req) {
  const header = req.headers.authorization ?? "";
  const key = header.startsWith("Bearer ") ? header.slice(7).trim() : "";
  if (!key) return null;
  return keyTable().get(key) ?? null;
}

export function pdEnvironment() {
  return process.env.PIPEDREAM_ENVIRONMENT === "production"
    ? "production"
    : "development";
}

export function pdProjectId() {
  return process.env.PIPEDREAM_PROJECT_ID ?? "";
}

// Project access token via client-credentials, cached until near expiry
// (per warm lambda; a refetch is cheap on cold starts).
let cached = null;
export async function pdAccessToken() {
  if (cached && cached.exp > Date.now() + 60_000) return cached;
  const res = await fetch(`${PD_API}/oauth/token`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      grant_type: "client_credentials",
      client_id: process.env.PIPEDREAM_CLIENT_ID,
      client_secret: process.env.PIPEDREAM_CLIENT_SECRET,
    }),
  });
  if (!res.ok) throw new Error(`Pipedream oauth/token ${res.status}`);
  const data = await res.json();
  cached = {
    token: data.access_token,
    exp: Date.now() + (data.expires_in ?? 3600) * 1000,
  };
  return cached;
}

/** Authenticated Pipedream Connect API call for this project. */
export async function pdFetch(path, { method = "GET", body } = {}) {
  const { token } = await pdAccessToken();
  const res = await fetch(`${PD_API}/connect/${pdProjectId()}${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      "x-pd-environment": pdEnvironment(),
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  if (!res.ok) {
    const detail = await res.text();
    throw new Error(`Pipedream ${path} ${res.status}: ${detail.slice(0, 200)}`);
  }
  const text = await res.text();
  return text ? JSON.parse(text) : {};
}

export function json(res, status, body) {
  res.status(status).setHeader("Content-Type", "application/json");
  res.end(JSON.stringify(body));
}

/** Authenticated call to a raw /v1 Pipedream API path (outside /connect). */
export async function pdApiFetch(path) {
  const { token } = await pdAccessToken();
  const res = await fetch(`${PD_API}${path}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) {
    const detail = await res.text();
    throw new Error(`Pipedream ${path} ${res.status}: ${detail.slice(0, 200)}`);
  }
  return res.json();
}

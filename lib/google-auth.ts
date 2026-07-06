// Google OAuth for the Gmail connection. Sovereign shape: the user creates
// their OWN OAuth client in their OWN Google Cloud project (client ID/secret
// live in their deployment's env), authorizes once in-app, and the refresh
// token is stored only in their own database behind RLS. The app's vendor
// never sees a credential.
//
// The access token this mints is used two ways:
//  - as the Bearer token for Google's official Gmail MCP server
//    (https://gmailmcp.googleapis.com/mcp/v1) through our broker — reads,
//    drafts, labels;
//  - by the executor's ONE direct Gmail REST call (messages.send) for the
//    red-tier reply action, which the user approves via slide-to-send.

import { createClient } from "@/lib/supabase/server";

const AUTH_URL = "https://accounts.google.com/o/oauth2/v2/auth";
const TOKEN_URL = "https://oauth2.googleapis.com/token";

// gmail.modify covers read + label changes (archive = remove INBOX);
// gmail.compose covers drafts; gmail.send is the one power the slide-to-send
// action needs. All three must also be listed on the user's OAuth consent
// screen (Data Access) in their Google Cloud project.
export const GMAIL_SCOPES = [
  "https://www.googleapis.com/auth/gmail.modify",
  "https://www.googleapis.com/auth/gmail.compose",
  "https://www.googleapis.com/auth/gmail.send",
  "openid",
  "email",
];

export function googleOauthConfigured(): boolean {
  return Boolean(
    process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET,
  );
}

/** The app's OAuth callback URL, derived from the request origin so the same
 *  code works on localhost, the Vercel preview, and production. This exact URL
 *  must be listed as an Authorized redirect URI on the user's OAuth client. */
export function redirectUri(origin: string): string {
  return `${origin.replace(/\/$/, "")}/api/google/callback`;
}

/** The Google consent-screen URL to start the connection. `state` should be a
 *  random nonce the callback verifies (stashed in a short-lived cookie). */
export function buildAuthUrl(origin: string, state: string): string {
  const params = new URLSearchParams({
    client_id: process.env.GOOGLE_CLIENT_ID ?? "",
    redirect_uri: redirectUri(origin),
    response_type: "code",
    scope: GMAIL_SCOPES.join(" "),
    // offline + consent => Google returns a refresh token (the durable grant).
    access_type: "offline",
    prompt: "consent",
    state,
  });
  return `${AUTH_URL}?${params.toString()}`;
}

type TokenResponse = {
  access_token: string;
  expires_in: number;
  refresh_token?: string;
  scope?: string;
  id_token?: string;
};

async function postToken(body: URLSearchParams): Promise<TokenResponse> {
  const res = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body,
  });
  if (!res.ok) {
    const detail = await res.text();
    throw new Error(`Google token endpoint ${res.status}: ${detail.slice(0, 300)}`);
  }
  return (await res.json()) as TokenResponse;
}

/** Exchange the authorization code and persist the grant (upsert — one Google
 *  account per user). Returns the connected email when Google provides it. */
export async function exchangeCodeAndStore(
  origin: string,
  code: string,
): Promise<{ email: string | null }> {
  const tokens = await postToken(
    new URLSearchParams({
      client_id: process.env.GOOGLE_CLIENT_ID ?? "",
      client_secret: process.env.GOOGLE_CLIENT_SECRET ?? "",
      grant_type: "authorization_code",
      code,
      redirect_uri: redirectUri(origin),
    }),
  );
  if (!tokens.refresh_token) {
    throw new Error(
      "Google did not return a refresh token. Remove the app's access at myaccount.google.com/permissions and connect again.",
    );
  }

  // The id_token's payload carries the account email; decode without
  // verification (we just received it over TLS from Google's token endpoint).
  let email: string | null = null;
  if (tokens.id_token) {
    try {
      const payload = JSON.parse(
        Buffer.from(tokens.id_token.split(".")[1], "base64url").toString("utf8"),
      ) as { email?: string };
      email = payload.email ?? null;
    } catch {
      /* cosmetic only */
    }
  }

  const supabase = await createClient();
  const { error } = await supabase.from("google_tokens").upsert(
    {
      email,
      refresh_token: tokens.refresh_token,
      access_token: tokens.access_token,
      access_token_expires_at: new Date(
        Date.now() + (tokens.expires_in - 60) * 1000,
      ).toISOString(),
      scopes: (tokens.scope ?? "").split(" ").filter(Boolean),
    },
    { onConflict: "user_id" },
  );
  if (error) throw new Error(error.message);
  return { email };
}

export type GoogleConnection = {
  email: string | null;
  scopes: string[];
};

/** The connected Google account, or null when Gmail isn't connected yet. */
export async function getGoogleConnection(): Promise<GoogleConnection | null> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("google_tokens")
    .select("email, scopes")
    .maybeSingle();
  if (error) throw new Error(error.message);
  return data ? { email: data.email, scopes: data.scopes ?? [] } : null;
}

/** Disconnect Gmail: best-effort revoke at Google, then drop the stored grant. */
export async function disconnectGoogle(): Promise<void> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("google_tokens")
    .select("refresh_token")
    .maybeSingle();
  if (data?.refresh_token) {
    await fetch(
      `https://oauth2.googleapis.com/revoke?token=${encodeURIComponent(data.refresh_token)}`,
      { method: "POST" },
    ).catch(() => {});
  }
  const { error } = await supabase.from("google_tokens").delete().gte(
    // RLS already scopes to the user; a tautological filter satisfies
    // PostgREST's requirement that deletes carry a WHERE clause.
    "created_at",
    "1970-01-01",
  );
  if (error) throw new Error(error.message);
}

/** A currently-valid access token, refreshing (and caching) when the stored
 *  one is expired. Returns null when Gmail isn't connected. */
export async function getGoogleAccessToken(): Promise<string | null> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("google_tokens")
    .select("refresh_token, access_token, access_token_expires_at")
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) return null;

  const expiresAt = data.access_token_expires_at
    ? Date.parse(data.access_token_expires_at)
    : 0;
  if (data.access_token && expiresAt > Date.now() + 30_000) {
    return data.access_token;
  }

  if (!googleOauthConfigured()) {
    throw new Error("GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET are not set.");
  }
  const tokens = await postToken(
    new URLSearchParams({
      client_id: process.env.GOOGLE_CLIENT_ID ?? "",
      client_secret: process.env.GOOGLE_CLIENT_SECRET ?? "",
      grant_type: "refresh_token",
      refresh_token: data.refresh_token,
    }),
  );
  await supabase
    .from("google_tokens")
    .update({
      access_token: tokens.access_token,
      access_token_expires_at: new Date(
        Date.now() + (tokens.expires_in - 60) * 1000,
      ).toISOString(),
    })
    .gte("created_at", "1970-01-01");
  return tokens.access_token;
}

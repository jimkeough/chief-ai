// One place resolves the Supabase env vars, accepting BOTH naming schemes:
// the classic names from .env.example (anon + service_role) and the names the
// Vercel Marketplace Supabase integration injects on a one-click deploy
// (publishable + secret — the new API-key scheme). Without these fallbacks a
// deploy-button instance boots with env vars present but unread, which is the
// silent-failure mode SETUP-FRICTION entry 5 warns about.
//
// NEXT_PUBLIC_* reads stay literal property accesses so Next.js can inline
// them into client bundles.

export function supabaseUrl(): string {
  return process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
}

/** Browser-safe key: anon (classic) or publishable (marketplace). */
export function supabaseAnonKey(): string {
  return (
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ??
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ??
    ""
  );
}

/** Server-only god-mode key: service_role (classic) or secret (marketplace).
 *  Import only from server code — see lib/supabase/admin.ts for the rules. */
export function supabaseServiceKey(): string {
  return (
    process.env.SUPABASE_SERVICE_ROLE_KEY ?? process.env.SUPABASE_SECRET_KEY ?? ""
  );
}

/** Direct Postgres URL for the in-app migration runner (setup only, never hot
 *  paths). The marketplace injects both; prefer the session-mode (non-pooling
 *  transaction) URL — DDL through the transaction pooler misbehaves. */
export function supabaseDbUrl(): string {
  return (
    process.env.POSTGRES_URL_NON_POOLING ?? process.env.POSTGRES_URL ?? ""
  );
}

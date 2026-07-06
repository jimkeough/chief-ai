import { createClient as createSupabaseClient } from "@supabase/supabase-js";

// Service-role Supabase client — the ONE sanctioned exception to the
// session-client rule (see BUILD-BRIEF security rules). It exists solely for
// trusted server-side ingest that has no user session: the Pipedream webhook
// (/api/events/pipedream), which authenticates by verifying Pipedream's
// signature and then writes on behalf of the user the deployed trigger belongs
// to. Every call here MUST filter by a user_id the caller has already
// established out-of-band (a verified trigger row) — RLS is bypassed, so the
// scoping is manual and non-negotiable.
//
// Never import this from a request path that has a session; use lib/supabase/
// server.ts there so RLS does the work.

export function createAdminClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    throw new Error(
      "SUPABASE_SERVICE_ROLE_KEY is not set — proactive events need it.",
    );
  }
  return createSupabaseClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

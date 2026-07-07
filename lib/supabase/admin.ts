import { createClient as createSupabaseClient } from "@supabase/supabase-js";
import { supabaseServiceKey, supabaseUrl } from "@/lib/supabase/env";

// Service-role Supabase client — the sanctioned exceptions to the
// session-client rule (see BUILD-BRIEF security rules). It exists solely for
// trusted server-side paths that have no user session:
//  - the Pipedream webhook (/api/events/pipedream), which authenticates by
//    verifying Pipedream's signature and then writes on behalf of the user the
//    deployed trigger belongs to;
//  - first-render setup (/api/setup/*), which runs only while the instance is
//    unclaimed (zero users) and creates the one login.
// Every call here MUST scope itself out-of-band (a verified trigger row, or
// the zero-users gate) — RLS is bypassed, so the scoping is manual and
// non-negotiable.
//
// Never import this from a request path that has a session; use lib/supabase/
// server.ts there so RLS does the work.

export function createAdminClient() {
  const url = supabaseUrl();
  const key = supabaseServiceKey();
  if (!url || !key) {
    throw new Error(
      "SUPABASE_SERVICE_ROLE_KEY (or SUPABASE_SECRET_KEY) is not set.",
    );
  }
  return createSupabaseClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

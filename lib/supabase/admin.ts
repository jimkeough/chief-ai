import { createClient as createSupabaseClient } from "@supabase/supabase-js";
import { supabaseServiceKey, supabaseUrl } from "@/lib/supabase/env";

// Service-role Supabase client — the sanctioned exceptions to the
// session-client rule (see BUILD-BRIEF security rules). It exists solely for
// trusted server-side paths that have no user session:
//  - first-render setup (/api/setup/*), which runs only while the instance is
//    unclaimed (zero users) and creates the one login;
//  - the MCP Vault bridge, after session auth + an RLS-owned connection lookup,
//    to call service-role-only secret RPCs. Metadata still uses the session
//    client; decrypted credentials never cross the API boundary.
// Every call here MUST scope itself out-of-band (a verified trigger row, the
// zero-users gate, or an authenticated RLS-owned connection id) — RLS is
// bypassed, so the scoping is manual and non-negotiable.

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

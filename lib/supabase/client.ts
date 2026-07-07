import { createBrowserClient } from "@supabase/ssr";
import { supabaseAnonKey, supabaseUrl } from "@/lib/supabase/env";

// Browser-side Supabase client (used by the login form).
export function createClient() {
  return createBrowserClient(supabaseUrl(), supabaseAnonKey());
}

import "server-only";

import { createClient } from "@supabase/supabase-js";

import { supabaseServiceRoleKey, supabaseUrl } from "@/lib/env";

/**
 * Service-role client. Bypasses RLS, so every caller must establish ownership
 * itself before touching a row.
 *
 * Used for exactly three things:
 *   - client writes, which change Stripe seat billing
 *   - Stripe bookkeeping columns the agency must not be able to forge
 *   - the automation endpoint, which has no user session at all
 */
export function createSupabaseAdminClient() {
  return createClient(supabaseUrl(), supabaseServiceRoleKey(), {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
      detectSessionInUrl: false,
    },
  });
}

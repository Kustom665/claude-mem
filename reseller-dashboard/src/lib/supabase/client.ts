import { createBrowserClient } from "@supabase/ssr";

import { supabasePublishableKey, supabaseUrl } from "@/lib/env";

/** Browser client. Used for the logo upload, which streams the file directly. */
export function createSupabaseBrowserClient() {
  return createBrowserClient(supabaseUrl(), supabasePublishableKey());
}

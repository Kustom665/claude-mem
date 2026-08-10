import "server-only";

import { redirect } from "next/navigation";
import type { User } from "@supabase/supabase-js";

import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import type { Agency } from "@/types/database";

type SupabaseServerClient = Awaited<
  ReturnType<typeof createSupabaseServerClient>
>;

export type AgencySession = {
  supabase: SupabaseServerClient;
  user: User;
  agency: Agency;
};

async function loadAgency(
  supabase: SupabaseServerClient,
  userId: string,
): Promise<Agency | null> {
  const { data, error } = await supabase
    .from("agencies")
    .select("*")
    .eq("owner_id", userId)
    .maybeSingle();

  if (error) throw new Error(`Could not load agency: ${error.message}`);
  return (data as Agency | null) ?? null;
}

/**
 * The `on_auth_user_created` trigger normally creates this row at signup.
 * This covers accounts created before the migration ran, so an agency never
 * lands on a dead dashboard.
 */
async function bootstrapAgency(user: User): Promise<Agency> {
  const admin = createSupabaseAdminClient();
  const metadataName = user.user_metadata?.agency_name;

  const name =
    (typeof metadataName === "string" && metadataName.trim()) ||
    user.email?.split("@")[0] ||
    "My Agency";

  const { data, error } = await admin
    .from("agencies")
    .upsert({ owner_id: user.id, name: name.slice(0, 120) }, { onConflict: "owner_id" })
    .select("*")
    .single();

  if (error) throw new Error(`Could not create agency workspace: ${error.message}`);
  return data as Agency;
}

/**
 * Auth gate for every signed-in page. Next 16 wants this in layouts and route
 * handlers rather than the proxy, so the dashboard layout calls it once and
 * passes the result down.
 */
export async function requireAgency(): Promise<AgencySession> {
  const supabase = await createSupabaseServerClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) redirect("/login");

  const agency = (await loadAgency(supabase, user.id)) ?? (await bootstrapAgency(user));

  return { supabase, user, agency };
}

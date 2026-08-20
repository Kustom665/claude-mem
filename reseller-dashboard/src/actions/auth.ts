"use server";

import { redirect } from "next/navigation";

import { siteUrl } from "@/lib/env";
import { formError, type FormState } from "@/lib/form-state";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { fieldErrors, signInSchema, signUpSchema } from "@/lib/validation";

export async function signUpAction(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  const parsed = signUpSchema.safeParse({
    agencyName: formData.get("agencyName"),
    email: formData.get("email"),
    password: formData.get("password"),
  });

  if (!parsed.success) {
    return formError("Check the highlighted fields.", fieldErrors(parsed.error));
  }

  const supabase = await createSupabaseServerClient();

  // The `on_auth_user_created` trigger reads agency_name out of user metadata
  // and creates the workspace row.
  const { data, error } = await supabase.auth.signUp({
    email: parsed.data.email,
    password: parsed.data.password,
    options: {
      data: { agency_name: parsed.data.agencyName },
      emailRedirectTo: `${siteUrl()}/auth/callback?next=/dashboard`,
    },
  });

  if (error) return formError(error.message);

  if (!data.session) {
    return {
      ok: true,
      message:
        "Almost there — check your inbox and confirm your email address to finish setting up your workspace.",
    };
  }

  redirect("/dashboard");
}

export async function signInAction(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  const parsed = signInSchema.safeParse({
    email: formData.get("email"),
    password: formData.get("password"),
  });

  if (!parsed.success) {
    return formError("Check the highlighted fields.", fieldErrors(parsed.error));
  }

  const supabase = await createSupabaseServerClient();
  const { error } = await supabase.auth.signInWithPassword(parsed.data);

  if (error) return formError(error.message);

  redirect("/dashboard");
}

export async function signOutAction(): Promise<void> {
  const supabase = await createSupabaseServerClient();
  await supabase.auth.signOut();
  redirect("/login");
}

"use server";

import { revalidatePath } from "next/cache";

import { requireAgency } from "@/lib/agency";
import { formError, formSuccess, type FormState } from "@/lib/form-state";
import {
  LOGO_BUCKET,
  isOwnLogoUrl,
  logoPathFromPublicUrl,
} from "@/lib/logo-storage";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { brandingSchema, fieldErrors } from "@/lib/validation";

export async function updateBrandingAction(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  const { supabase, agency } = await requireAgency();

  const parsed = brandingSchema.safeParse({
    name: formData.get("name"),
    primaryColor: formData.get("primaryColor"),
    logoUrl: formData.get("logoUrl") ?? "",
  });

  if (!parsed.success) {
    return formError("Check the highlighted fields.", fieldErrors(parsed.error));
  }

  const { name, primaryColor, logoUrl } = parsed.data;

  if (logoUrl && !isOwnLogoUrl(logoUrl, agency.id)) {
    return formError(
      "That logo could not be verified. Upload the image again.",
      { logoUrl: "Upload the image again." },
    );
  }

  // RLS plus column grants mean this can only touch the caller's own branding
  // columns — stripe_customer_id and has_payment_method are not writable here.
  const { error } = await supabase
    .from("agencies")
    .update({ name, primary_color: primaryColor, logo_url: logoUrl })
    .eq("id", agency.id);

  if (error) return formError(`Could not save branding: ${error.message}`);

  const previousPath = logoPathFromPublicUrl(agency.logo_url);
  const nextPath = logoPathFromPublicUrl(logoUrl);

  if (previousPath && previousPath !== nextPath) {
    // Best effort: a stray object costs storage but must not fail the save.
    await createSupabaseAdminClient()
      .storage.from(LOGO_BUCKET)
      .remove([previousPath]);
  }

  // The shell renders the logo, name and theme, so refresh the whole tree.
  revalidatePath("/", "layout");

  return formSuccess("Branding saved. Your dashboard and texts now use it.");
}

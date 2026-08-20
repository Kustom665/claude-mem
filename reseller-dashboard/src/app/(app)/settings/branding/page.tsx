import type { Metadata } from "next";

import { updateBrandingAction } from "@/actions/branding";
import { BrandingForm } from "@/components/branding-form";
import { PageHeader } from "@/components/ui";
import { requireAgency } from "@/lib/agency";

export const metadata: Metadata = { title: "Branding" };

export default async function BrandingSettingsPage() {
  const { agency } = await requireAgency();

  return (
    <>
      <PageHeader
        title="Branding"
        description="Your logo, colour and business name — applied to this dashboard and to every text your clients send."
      />
      <BrandingForm agency={agency} action={updateBrandingAction} />
    </>
  );
}

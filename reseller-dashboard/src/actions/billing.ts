"use server";

import { redirect } from "next/navigation";

import { requireAgency } from "@/lib/agency";
import {
  createBillingPortalSession,
  createCardSetupSession,
  describeStripeError,
} from "@/lib/seats";

function billingErrorUrl(error: unknown): string {
  return `/settings/billing?error=${encodeURIComponent(describeStripeError(error))}`;
}

/** Sends the agency to Stripe Checkout in setup mode to save a card. */
export async function startCardSetupAction(): Promise<void> {
  const { agency } = await requireAgency();

  let url: string;
  try {
    url = await createCardSetupSession(agency);
  } catch (error) {
    redirect(billingErrorUrl(error));
  }

  redirect(url);
}

/** Opens the Stripe billing portal to manage the card and see invoices. */
export async function openBillingPortalAction(): Promise<void> {
  const { agency } = await requireAgency();

  let url: string;
  try {
    url = await createBillingPortalSession(agency);
  } catch (error) {
    redirect(billingErrorUrl(error));
  }

  redirect(url);
}

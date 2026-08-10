import "server-only";

import type Stripe from "stripe";

import { isStripeConfigured, siteUrl, stripeSeatPriceId } from "@/lib/env";
import { stripe } from "@/lib/stripe";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import type { Agency, Client, SeatStatus } from "@/types/database";

/**
 * Seat billing model
 * ------------------
 * One Stripe subscription per ACTIVE client seat, all on the agency's Stripe
 * customer and therefore the agency's card. Pausing a client cancels its
 * subscription; re-activating creates a new one. `clients.resale_price_cents`
 * — what the agency charges its own client — never reaches Stripe.
 */

export type SeatPrice = {
  id: string;
  unitAmountCents: number | null;
  currency: string;
  interval: string;
};

let cachedPrice: SeatPrice | null = null;

export async function getSeatPrice(): Promise<SeatPrice> {
  if (cachedPrice) return cachedPrice;

  const price = await stripe().prices.retrieve(stripeSeatPriceId());

  cachedPrice = {
    id: price.id,
    unitAmountCents: price.unit_amount,
    currency: price.currency,
    interval: price.recurring?.interval ?? "month",
  };

  return cachedPrice;
}

/**
 * Seat price for display. Returns null when Stripe is not wired up yet, so the
 * dashboard renders rather than erroring during initial setup.
 */
export async function trySeatPrice(): Promise<SeatPrice | null> {
  if (!isStripeConfigured()) return null;
  try {
    return await getSeatPrice();
  } catch {
    return null;
  }
}

export function mapSeatStatus(status: Stripe.Subscription.Status): SeatStatus {
  switch (status) {
    case "active":
      return "active";
    case "trialing":
      return "trialing";
    case "past_due":
    case "unpaid":
      return "past_due";
    case "canceled":
    case "paused":
      return "canceled";
    default:
      return "incomplete";
  }
}

/** Creates the agency's Stripe customer on first use and stores the id. */
export async function ensureStripeCustomer(agency: Agency): Promise<string> {
  if (agency.stripe_customer_id) return agency.stripe_customer_id;

  const customer = await stripe().customers.create({
    name: agency.name,
    metadata: { agency_id: agency.id },
  });

  const admin = createSupabaseAdminClient();
  const { error } = await admin
    .from("agencies")
    .update({ stripe_customer_id: customer.id })
    .eq("id", agency.id);

  if (error) {
    // The customer exists in Stripe but we could not record it. Removing it
    // keeps the two sides from drifting into a duplicate on the next attempt.
    await stripe().customers.del(customer.id).catch(() => undefined);
    throw new Error(`Could not save the Stripe customer: ${error.message}`);
  }

  return customer.id;
}

export type CardSummary = {
  brand: string;
  last4: string;
  expMonth: number;
  expYear: number;
};

export type BillingState = {
  hasPaymentMethod: boolean;
  card: CardSummary | null;
};

/**
 * Reconciles `agencies.has_payment_method` with Stripe and returns the truth.
 * Called when rendering billing so a missed webhook cannot strand an agency.
 */
export async function syncBillingState(agency: Agency): Promise<BillingState> {
  if (!agency.stripe_customer_id) return { hasPaymentMethod: false, card: null };

  const customer = await stripe().customers.retrieve(agency.stripe_customer_id);
  if (customer.deleted) return { hasPaymentMethod: false, card: null };

  let defaultMethod = customer.invoice_settings?.default_payment_method ?? null;

  if (!defaultMethod) {
    // A card may be attached without being the invoice default yet — promote it
    // so subscription charges have something to bill.
    const methods = await stripe().paymentMethods.list({
      customer: customer.id,
      type: "card",
      limit: 1,
    });

    const candidate = methods.data[0];
    if (candidate) {
      await stripe().customers.update(customer.id, {
        invoice_settings: { default_payment_method: candidate.id },
      });
      defaultMethod = candidate;
    }
  }

  const hasPaymentMethod = Boolean(defaultMethod);

  if (hasPaymentMethod !== agency.has_payment_method) {
    await createSupabaseAdminClient()
      .from("agencies")
      .update({ has_payment_method: hasPaymentMethod })
      .eq("id", agency.id);
  }

  return { hasPaymentMethod, card: await describeCard(defaultMethod) };
}

async function describeCard(
  method: string | Stripe.PaymentMethod | null,
): Promise<CardSummary | null> {
  if (!method) return null;

  const resolved =
    typeof method === "string"
      ? await stripe().paymentMethods.retrieve(method).catch(() => null)
      : method;

  const card = resolved?.card;
  if (!card) return null;

  return {
    brand: card.brand,
    last4: card.last4,
    expMonth: card.exp_month,
    expYear: card.exp_year,
  };
}

/** Hosted card capture. Setup mode: saves a card without charging it. */
export async function createCardSetupSession(agency: Agency): Promise<string> {
  const customer = await ensureStripeCustomer(agency);

  const session = await stripe().checkout.sessions.create({
    mode: "setup",
    customer,
    currency: (await getSeatPrice()).currency,
    success_url: `${siteUrl()}/settings/billing?card=saved`,
    cancel_url: `${siteUrl()}/settings/billing?card=cancelled`,
    metadata: { agency_id: agency.id },
  });

  if (!session.url) throw new Error("Stripe did not return a checkout URL.");
  return session.url;
}

export async function createBillingPortalSession(
  agency: Agency,
): Promise<string> {
  const customer = await ensureStripeCustomer(agency);

  const session = await stripe().billingPortal.sessions.create({
    customer,
    return_url: `${siteUrl()}/settings/billing`,
  });

  return session.url;
}

type SeatSubscriptionResult = {
  subscriptionId: string;
  seatStatus: SeatStatus;
};

/** Starts billing one seat. The caller must have verified a card is on file. */
export async function createSeatSubscription(
  agency: Agency,
  client: Pick<Client, "id" | "business_name">,
): Promise<SeatSubscriptionResult> {
  const customer = await ensureStripeCustomer(agency);

  const subscription = await stripe().subscriptions.create({
    customer,
    items: [{ price: stripeSeatPriceId(), quantity: 1 }],
    // Surface a declined card as a thrown error instead of a silently
    // incomplete subscription that never actually bills.
    payment_behavior: "error_if_incomplete",
    metadata: {
      agency_id: agency.id,
      client_id: client.id,
      client_business_name: client.business_name,
    },
  });

  return {
    subscriptionId: subscription.id,
    seatStatus: mapSeatStatus(subscription.status),
  };
}

/** Stops billing one seat. Already-cancelled or missing subscriptions are fine. */
export async function cancelSeatSubscription(
  subscriptionId: string,
): Promise<void> {
  try {
    await stripe().subscriptions.cancel(subscriptionId);
  } catch (error) {
    const code = (error as Stripe.errors.StripeError)?.code;
    const statusCode = (error as Stripe.errors.StripeError)?.statusCode;
    const alreadyGone =
      statusCode === 404 || code === "resource_missing";

    if (!alreadyGone) throw error;
  }
}

export function describeStripeError(error: unknown): string {
  if (typeof error === "object" && error !== null && "message" in error) {
    const message = (error as { message?: unknown }).message;
    if (typeof message === "string" && message.trim() !== "") return message;
  }
  return "Stripe rejected the request. Check the Stripe dashboard for details.";
}

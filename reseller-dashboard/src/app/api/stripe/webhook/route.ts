import { NextResponse, type NextRequest } from "next/server";
import type Stripe from "stripe";

import { stripeWebhookSecret } from "@/lib/env";
import { mapSeatStatus } from "@/lib/seats";
import { stripe } from "@/lib/stripe";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";

export const runtime = "nodejs";
/** Stripe signs the raw body, so this route must never be cached or rewritten. */
export const dynamic = "force-dynamic";

const HANDLED_EVENTS = new Set<Stripe.Event.Type>([
  "checkout.session.completed",
  "payment_method.attached",
  "customer.subscription.created",
  "customer.subscription.updated",
  "customer.subscription.deleted",
  "invoice.payment_failed",
]);

export async function POST(request: NextRequest) {
  const signature = request.headers.get("stripe-signature");
  if (!signature) {
    return NextResponse.json({ error: "Missing signature" }, { status: 400 });
  }

  const payload = await request.text();

  // Resolved before verification so a missing key answers 500 (Stripe retries)
  // rather than 400 (Stripe gives up on a valid event).
  let secret: string;
  let client: Stripe;
  try {
    secret = stripeWebhookSecret();
    client = stripe();
  } catch (error) {
    console.error("Stripe webhook is not configured", error);
    return NextResponse.json({ error: "Stripe not configured" }, { status: 500 });
  }

  let event: Stripe.Event;
  try {
    event = await client.webhooks.constructEventAsync(
      payload,
      signature,
      secret,
    );
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Invalid Stripe signature";
    return NextResponse.json({ error: message }, { status: 400 });
  }

  if (!HANDLED_EVENTS.has(event.type)) {
    return NextResponse.json({ received: true, handled: false });
  }

  try {
    await handleEvent(event);
  } catch (error) {
    // A 500 makes Stripe retry, which is what we want for a transient failure.
    console.error(`Stripe webhook ${event.type} failed`, error);
    return NextResponse.json({ error: "Handler failed" }, { status: 500 });
  }

  return NextResponse.json({ received: true, handled: true });
}

async function handleEvent(event: Stripe.Event): Promise<void> {
  switch (event.type) {
    case "checkout.session.completed":
      await handleCheckoutCompleted(event.data.object);
      return;

    case "payment_method.attached":
      await handlePaymentMethodAttached(event.data.object);
      return;

    case "customer.subscription.created":
    case "customer.subscription.updated":
    case "customer.subscription.deleted":
      await handleSubscriptionChange(event.data.object, event.type);
      return;

    case "invoice.payment_failed":
      await handleInvoicePaymentFailed(event.data.object);
      return;

    default:
      return;
  }
}

function customerIdOf(
  customer: string | Stripe.Customer | Stripe.DeletedCustomer | null,
): string | null {
  if (!customer) return null;
  return typeof customer === "string" ? customer : customer.id;
}

async function setPaymentMethodFlag(
  customerId: string,
  hasPaymentMethod: boolean,
): Promise<void> {
  await createSupabaseAdminClient()
    .from("agencies")
    .update({ has_payment_method: hasPaymentMethod })
    .eq("stripe_customer_id", customerId);
}

/** Setup-mode Checkout: promote the saved card to the customer's default. */
async function handleCheckoutCompleted(
  session: Stripe.Checkout.Session,
): Promise<void> {
  if (session.mode !== "setup") return;

  const customerId = customerIdOf(session.customer);
  if (!customerId) return;

  const setupIntentId =
    typeof session.setup_intent === "string"
      ? session.setup_intent
      : session.setup_intent?.id;

  if (!setupIntentId) return;

  const setupIntent = await stripe().setupIntents.retrieve(setupIntentId);
  const paymentMethod =
    typeof setupIntent.payment_method === "string"
      ? setupIntent.payment_method
      : setupIntent.payment_method?.id;

  if (!paymentMethod) return;

  await stripe().customers.update(customerId, {
    invoice_settings: { default_payment_method: paymentMethod },
  });

  await setPaymentMethodFlag(customerId, true);
}

/** Covers cards added through the billing portal rather than Checkout. */
async function handlePaymentMethodAttached(
  method: Stripe.PaymentMethod,
): Promise<void> {
  const customerId = customerIdOf(method.customer);
  if (!customerId) return;

  const customer = await stripe().customers.retrieve(customerId);
  if (customer.deleted) return;

  if (!customer.invoice_settings?.default_payment_method) {
    await stripe().customers.update(customerId, {
      invoice_settings: { default_payment_method: method.id },
    });
  }

  await setPaymentMethodFlag(customerId, true);
}

/**
 * Keeps `clients.seat_status` in step with Stripe. A subscription that ends
 * outside the dashboard — dunning giving up, a cancel from the portal — also
 * pauses the client, because a seat is only billed while the client is active.
 */
async function handleSubscriptionChange(
  subscription: Stripe.Subscription,
  eventType: Stripe.Event.Type,
): Promise<void> {
  const admin = createSupabaseAdminClient();
  const ended =
    eventType === "customer.subscription.deleted" ||
    subscription.status === "canceled";

  const patch = ended
    ? {
        seat_status: "canceled" as const,
        stripe_subscription_id: null,
        status: "paused" as const,
      }
    : { seat_status: mapSeatStatus(subscription.status) };

  const { data } = await admin
    .from("clients")
    .update(patch)
    .eq("stripe_subscription_id", subscription.id)
    .select("id");

  if (data && data.length > 0) return;

  // The row may not have recorded the subscription id yet (a webhook can beat
  // the create call's own update), so fall back to the metadata we set.
  const clientId = subscription.metadata?.client_id;
  if (!clientId) return;

  await admin.from("clients").update(patch).eq("id", clientId);
}

async function handleInvoicePaymentFailed(
  invoice: Stripe.Invoice,
): Promise<void> {
  const subscriptionIds = new Set<string>();

  for (const line of invoice.lines?.data ?? []) {
    const subscription = line.parent?.subscription_item_details?.subscription;
    if (subscription) subscriptionIds.add(subscription);
  }

  if (subscriptionIds.size === 0) return;

  const admin = createSupabaseAdminClient();
  await admin
    .from("clients")
    .update({ seat_status: "past_due" })
    .in("stripe_subscription_id", [...subscriptionIds]);
}

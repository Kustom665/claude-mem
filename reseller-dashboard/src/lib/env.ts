/**
 * Environment access.
 *
 * Every read is lazy and throws at call time rather than import time, so a
 * missing variable surfaces as a clear error on the request that needs it
 * instead of failing the whole build.
 */

function required(name: string, value: string | undefined): string {
  if (!value || value.trim() === "") {
    throw new Error(
      `Missing required environment variable ${name}. See .env.example.`,
    );
  }
  return value;
}

export function supabaseUrl(): string {
  return required(
    "NEXT_PUBLIC_SUPABASE_URL",
    process.env.NEXT_PUBLIC_SUPABASE_URL,
  );
}

/** The browser-safe key. Supabase renamed "anon" to "publishable"; accept both. */
export function supabasePublishableKey(): string {
  const key =
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ??
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  return required("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY", key);
}

export function supabaseServiceRoleKey(): string {
  return required(
    "SUPABASE_SERVICE_ROLE_KEY",
    process.env.SUPABASE_SERVICE_ROLE_KEY,
  );
}

export function stripeSecretKey(): string {
  return required("STRIPE_SECRET_KEY", process.env.STRIPE_SECRET_KEY);
}

export function stripeSeatPriceId(): string {
  return required("STRIPE_SEAT_PRICE_ID", process.env.STRIPE_SEAT_PRICE_ID);
}

export function stripeWebhookSecret(): string {
  return required("STRIPE_WEBHOOK_SECRET", process.env.STRIPE_WEBHOOK_SECRET);
}

export function automationApiSecret(): string {
  return required("AUTOMATION_API_SECRET", process.env.AUTOMATION_API_SECRET);
}

/** Absolute origin, used for auth callbacks and Stripe return URLs. */
export function siteUrl(): string {
  const explicit = process.env.NEXT_PUBLIC_SITE_URL;
  if (explicit) return explicit.replace(/\/$/, "");

  const vercel =
    process.env.VERCEL_PROJECT_PRODUCTION_URL ?? process.env.VERCEL_URL;
  if (vercel) return `https://${vercel.replace(/\/$/, "")}`;

  return "http://localhost:3000";
}

/** True when Stripe is configured. Lets billing pages degrade instead of crash. */
export function isStripeConfigured(): boolean {
  return Boolean(
    process.env.STRIPE_SECRET_KEY && process.env.STRIPE_SEAT_PRICE_ID,
  );
}

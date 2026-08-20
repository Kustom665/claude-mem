import "server-only";

import Stripe from "stripe";

import { stripeSecretKey } from "@/lib/env";

let client: Stripe | null = null;

/** Lazily constructed so a missing key fails on the request, not at build. */
export function stripe(): Stripe {
  client ??= new Stripe(stripeSecretKey(), {
    appInfo: { name: "White-label Reseller Dashboard" },
  });
  return client;
}

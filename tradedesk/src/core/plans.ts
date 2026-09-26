/**
 * Plan definitions and entitlement resolution.
 *
 * Two kinds of entitlement:
 *   - Feature flags: boolean capabilities unlocked by tier.
 *   - Metered limits: numeric caps consumed over a billing period (null = unlimited).
 *
 * Plan keys are stable identifiers persisted in the DB and referenced by Stripe
 * price metadata. Display names live in brand.config.ts and may change freely.
 */

export type PlanKey = "starter" | "pro" | "premium";

export type Feature =
  | "invoices"
  | "estimates"
  | "jobs_scheduling"
  | "customers_crm"
  | "logo_branding"
  | "card_payments"
  | "manual_reminders"
  | "two_way_sms"
  | "branded_website"
  | "online_booking"
  | "attachments"
  | "recurring_billing"
  | "review_management"
  | "marketing_campaigns"
  | "inventory"
  | "suppliers"
  | "time_tracking"
  | "reports"
  | "profit_and_loss"
  | "finance_suite"
  | "ops_log"
  | "ai_job_assistant";

export type Meter = "sms_sent" | "team_seats" | "ai_assist_calls";

export interface Plan {
  key: PlanKey;
  /** Price in minor units (cents), per seat per month. */
  monthlyCents: number;
  annualCentsPerMonth: number;
  features: readonly Feature[];
  /** null means unlimited. */
  limits: Readonly<Record<Meter, number | null>>;
}

const STARTER_FEATURES = [
  "invoices",
  "estimates",
  "jobs_scheduling",
  "customers_crm",
  "logo_branding",
  "card_payments",
  "manual_reminders",
  "ops_log",
] as const satisfies readonly Feature[];

const PRO_FEATURES = [
  ...STARTER_FEATURES,
  "two_way_sms",
  "branded_website",
  "online_booking",
  "attachments",
  "recurring_billing",
  // Our differentiator ships from Pro up, not gated to the top tier.
  "ai_job_assistant",
] as const satisfies readonly Feature[];

const PREMIUM_FEATURES = [
  ...PRO_FEATURES,
  "review_management",
  "marketing_campaigns",
  "inventory",
  "suppliers",
  "time_tracking",
  "reports",
  "profit_and_loss",
  "finance_suite",
] as const satisfies readonly Feature[];

export const PLANS: Readonly<Record<PlanKey, Plan>> = {
  starter: {
    key: "starter",
    monthlyCents: 3900,
    annualCentsPerMonth: 2500,
    features: STARTER_FEATURES,
    limits: { sms_sent: 0, team_seats: 1, ai_assist_calls: 0 },
  },
  pro: {
    key: "pro",
    monthlyCents: 6900,
    annualCentsPerMonth: 4900,
    features: PRO_FEATURES,
    limits: { sms_sent: 200, team_seats: 2, ai_assist_calls: 500 },
  },
  premium: {
    key: "premium",
    monthlyCents: 12900,
    annualCentsPerMonth: 7900,
    features: PREMIUM_FEATURES,
    limits: { sms_sent: 2000, team_seats: 10, ai_assist_calls: null },
  },
};

export const PLAN_ORDER: readonly PlanKey[] = ["starter", "pro", "premium"];

/** Lowest plan that grants `feature`, or null if no plan does. */
export function minimumPlanFor(feature: Feature): PlanKey | null {
  return PLAN_ORDER.find((k) => PLANS[k].features.includes(feature)) ?? null;
}

export function hasFeature(plan: PlanKey, feature: Feature): boolean {
  return PLANS[plan].features.includes(feature);
}

export function limitFor(plan: PlanKey, meter: Meter): number | null {
  return PLANS[plan].limits[meter];
}

export interface DenialReason {
  allowed: false;
  code: "feature_locked" | "limit_exceeded";
  message: string;
  /** Plan the account must move to in order to proceed, if one exists. */
  upgradeTo: PlanKey | null;
}

export type Decision = { allowed: true } | DenialReason;

const ALLOWED: Decision = { allowed: true };

/**
 * Gate a feature. Call at the boundary of every tiered capability — never rely
 * on the UI hiding a button, since the API is reachable directly.
 */
export function checkFeature(plan: PlanKey, feature: Feature): Decision {
  if (hasFeature(plan, feature)) return ALLOWED;
  return {
    allowed: false,
    code: "feature_locked",
    message: `${feature} is not included in the ${plan} plan.`,
    upgradeTo: minimumPlanFor(feature),
  };
}

/**
 * Gate a metered action. `used` is consumption so far this billing period and
 * `requested` the units this action would add.
 */
export function checkMeter(
  plan: PlanKey,
  meter: Meter,
  used: number,
  requested = 1,
): Decision {
  if (requested < 0) throw new RangeError("requested must be non-negative");
  const cap = limitFor(plan, meter);
  if (cap === null) return ALLOWED;
  if (used + requested <= cap) return ALLOWED;

  // Surface the cheapest plan that would actually fit this request, so the
  // upsell we show is one that resolves the block rather than the next tier up.
  const upgradeTo =
    PLAN_ORDER.find((k) => {
      const c = limitFor(k, meter);
      return c === null || used + requested <= c;
    }) ?? null;

  return {
    allowed: false,
    code: "limit_exceeded",
    message: `${meter} limit reached for the ${plan} plan (${used}/${cap} used).`,
    upgradeTo,
  };
}

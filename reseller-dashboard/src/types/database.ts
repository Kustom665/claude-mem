/**
 * Hand-written mirror of supabase/migrations. Regenerate with
 * `supabase gen types typescript` once the project is linked if you prefer.
 */

export type ClientStatus = "active" | "paused";

export type SeatStatus =
  | "none"
  | "active"
  | "trialing"
  | "past_due"
  | "canceled"
  | "incomplete";

export const DAY_KEYS = [
  "mon",
  "tue",
  "wed",
  "thu",
  "fri",
  "sat",
  "sun",
] as const;

export type DayKey = (typeof DAY_KEYS)[number];

export type DayHours = {
  closed: boolean;
  /** "HH:MM", 24-hour, in the client's timezone. */
  open: string;
  close: string;
};

export type BusinessHours = Record<DayKey, DayHours>;

export type Agency = {
  id: string;
  owner_id: string;
  name: string;
  logo_url: string | null;
  primary_color: string;
  stripe_customer_id: string | null;
  has_payment_method: boolean;
  created_at: string;
  updated_at: string;
};

export type Client = {
  id: string;
  agency_id: string;
  business_name: string;
  phone_number: string;
  timezone: string;
  hours: BusinessHours;
  auto_reply_message: string;
  status: ClientStatus;
  resale_price_cents: number | null;
  stripe_subscription_id: string | null;
  seat_status: SeatStatus;
  created_at: string;
  updated_at: string;
};

/** `public.client_overview` — clients plus this month's lead counts. */
export type ClientOverview = Client & {
  leads_this_month: number;
  replied_this_month: number;
};

export type Lead = {
  id: string;
  client_id: string;
  caller_number: string;
  captured_at: string;
  replied: boolean;
};

export type ClientInsert = Pick<
  Client,
  | "agency_id"
  | "business_name"
  | "phone_number"
  | "timezone"
  | "hours"
  | "auto_reply_message"
  | "status"
  | "resale_price_cents"
>;

export type ClientUpdate = Partial<Omit<ClientInsert, "agency_id">>;

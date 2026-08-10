import type { Metadata } from "next";

import {
  openBillingPortalAction,
  startCardSetupAction,
} from "@/actions/billing";
import { SubmitButton } from "@/components/submit-button";
import { Alert, Card, CardHeader, PageHeader } from "@/components/ui";
import { requireAgency } from "@/lib/agency";
import { isStripeConfigured } from "@/lib/env";
import { formatMoney } from "@/lib/format";
import { syncBillingState, trySeatPrice } from "@/lib/seats";

export const metadata: Metadata = { title: "Billing" };

export default async function BillingSettingsPage({
  searchParams,
}: {
  searchParams: Promise<{ card?: string; error?: string }>;
}) {
  const { card: cardParam, error } = await searchParams;
  const { supabase, agency } = await requireAgency();

  if (!isStripeConfigured()) {
    return (
      <>
        <PageHeader title="Billing" />
        <Alert tone="info">
          Stripe is not configured yet. Set <code>STRIPE_SECRET_KEY</code>,{" "}
          <code>STRIPE_SEAT_PRICE_ID</code> and <code>STRIPE_WEBHOOK_SECRET</code>{" "}
          to start billing client seats. Until then you can still add clients —
          they simply will not consume a paid seat.
        </Alert>
      </>
    );
  }

  const [{ count: activeSeats }, seatPrice, billing] = await Promise.all([
    supabase
      .from("clients")
      .select("id", { count: "exact", head: true })
      .eq("status", "active"),
    trySeatPrice(),
    syncBillingState(agency),
  ]);

  const { data: activeClients } = await supabase
    .from("clients")
    .select("resale_price_cents")
    .eq("status", "active");

  const seats = activeSeats ?? 0;
  const currency = seatPrice?.currency ?? "usd";
  const monthlyCost =
    seatPrice?.unitAmountCents != null ? seats * seatPrice.unitAmountCents : null;
  const monthlyResale = (
    (activeClients ?? []) as { resale_price_cents: number | null }[]
  ).reduce((total, row) => total + (row.resale_price_cents ?? 0), 0);

  return (
    <>
      <PageHeader
        title="Billing"
        description="One subscription per active client seat, charged to your card each month."
      />

      {error ? (
        <Alert tone="error" className="mb-6">
          {error}
        </Alert>
      ) : null}
      {cardParam === "saved" ? (
        <Alert tone="success" className="mb-6">
          Card saved. You can activate client seats now.
        </Alert>
      ) : null}
      {cardParam === "cancelled" ? (
        <Alert tone="info" className="mb-6">
          Card setup cancelled — nothing was charged.
        </Alert>
      ) : null}

      <div className="space-y-6">
        <Card>
          <CardHeader
            title="Payment method"
            description="Every client seat is billed to this card."
          />
          <div className="flex flex-wrap items-center justify-between gap-4 px-5 py-5">
            {billing.card ? (
              <div>
                <p className="text-sm font-medium text-slate-900 capitalize">
                  {billing.card.brand} ···· {billing.card.last4}
                </p>
                <p className="mt-0.5 text-sm text-slate-500">
                  Expires{" "}
                  {String(billing.card.expMonth).padStart(2, "0")}/
                  {billing.card.expYear}
                </p>
              </div>
            ) : (
              <p className="text-sm text-slate-600">
                No card on file. Client seats stay paused until you add one.
              </p>
            )}

            <div className="flex flex-wrap gap-2">
              <form action={startCardSetupAction}>
                <SubmitButton
                  variant={billing.hasPaymentMethod ? "secondary" : "primary"}
                  pendingLabel="Opening Stripe…"
                >
                  {billing.hasPaymentMethod ? "Replace card" : "Add card"}
                </SubmitButton>
              </form>

              {agency.stripe_customer_id ? (
                <form action={openBillingPortalAction}>
                  <SubmitButton variant="secondary" pendingLabel="Opening…">
                    Invoices &amp; portal
                  </SubmitButton>
                </form>
              ) : null}
            </div>
          </div>
        </Card>

        <Card>
          <CardHeader
            title="Seats"
            description="A seat is billed while a client is active. Pausing a client cancels its seat immediately."
          />
          <dl className="divide-y divide-slate-100">
            <Row
              label="Price per seat"
              value={
                seatPrice?.unitAmountCents != null
                  ? `${formatMoney(seatPrice.unitAmountCents, currency)} / ${seatPrice.interval}`
                  : "Set by your Stripe price"
              }
            />
            <Row label="Active seats" value={String(seats)} />
            <Row
              label="Your monthly cost"
              value={
                monthlyCost === null ? "—" : formatMoney(monthlyCost, currency)
              }
              emphasis
            />
            <Row
              label="Your monthly resale"
              value={
                monthlyResale > 0 ? formatMoney(monthlyResale, currency) : "—"
              }
              hint="Sum of the resale prices you recorded. Informational only — Stripe never charges this."
            />
            <Row
              label="Your monthly margin"
              value={
                monthlyCost === null || monthlyResale === 0
                  ? "—"
                  : formatMoney(monthlyResale - monthlyCost, currency)
              }
            />
          </dl>
        </Card>
      </div>
    </>
  );
}

function Row({
  label,
  value,
  hint,
  emphasis,
}: {
  label: string;
  value: string;
  hint?: string;
  emphasis?: boolean;
}) {
  return (
    <div className="flex flex-wrap items-baseline justify-between gap-2 px-5 py-4">
      <dt className="text-sm text-slate-600">
        {label}
        {hint ? (
          <span className="mt-0.5 block max-w-md text-xs text-slate-400">
            {hint}
          </span>
        ) : null}
      </dt>
      <dd
        className={
          emphasis
            ? "text-lg font-semibold text-slate-900"
            : "text-sm font-medium text-slate-900"
        }
      >
        {value}
      </dd>
    </div>
  );
}

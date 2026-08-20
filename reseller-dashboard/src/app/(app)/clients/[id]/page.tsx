import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";

import { deleteClientAction, updateClientAction } from "@/actions/clients";
import { ClientForm } from "@/components/client-form";
import { SubmitButton } from "@/components/submit-button";
import { Alert, Card, CardHeader, PageHeader, StatusBadge } from "@/components/ui";
import { requireAgency } from "@/lib/agency";
import { formatDate, formatPhoneNumber } from "@/lib/format";
import { isOpenAt, summarizeHours, supportedTimeZones } from "@/lib/hours";
import { trySeatPrice } from "@/lib/seats";
import type { Client } from "@/types/database";

export const metadata: Metadata = { title: "Client" };

const SEAT_LABELS: Record<string, string> = {
  none: "No seat — not billing",
  active: "Seat active",
  trialing: "Seat trialing",
  past_due: "Payment past due",
  canceled: "Seat cancelled",
  incomplete: "Seat incomplete — check Stripe",
};

export default async function ClientDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ notice?: string }>;
}) {
  const [{ id }, { notice }] = await Promise.all([params, searchParams]);
  const { supabase, agency } = await requireAgency();

  const [{ data }, seatPrice] = await Promise.all([
    supabase.from("clients").select("*").eq("id", id).maybeSingle(),
    trySeatPrice(),
  ]);

  const client = data as Client | null;
  if (!client) notFound();

  const openNow = isOpenAt(client.hours, client.timezone);

  return (
    <>
      <PageHeader
        title={client.business_name}
        description={`${formatPhoneNumber(client.phone_number)} · added ${formatDate(client.created_at)}`}
        action={
          <Link
            href="/dashboard"
            className="text-sm font-medium text-slate-500 hover:text-slate-900"
          >
            ← All clients
          </Link>
        }
      />

      {notice ? (
        <Alert tone="warning" className="mb-6">
          {notice}
        </Alert>
      ) : null}

      <Card className="mb-6">
        <div className="grid gap-4 px-5 py-4 sm:grid-cols-3">
          <div>
            <p className="text-xs font-medium tracking-wide text-slate-500 uppercase">
              Status
            </p>
            <div className="mt-1.5">
              <StatusBadge status={client.status} />
            </div>
          </div>
          <div>
            <p className="text-xs font-medium tracking-wide text-slate-500 uppercase">
              Billing
            </p>
            <p className="mt-1.5 text-sm text-slate-700">
              {SEAT_LABELS[client.seat_status] ?? client.seat_status}
            </p>
          </div>
          <div>
            <p className="text-xs font-medium tracking-wide text-slate-500 uppercase">
              Hours
            </p>
            <p className="mt-1.5 text-sm text-slate-700">
              {summarizeHours(client.hours)}
              {openNow === null ? null : (
                <span className="text-slate-500">
                  {" · "}
                  {openNow ? "open now" : "closed now"}
                </span>
              )}
            </p>
          </div>
        </div>
      </Card>

      <ClientForm
        agencyName={agency.name}
        timezones={supportedTimeZones()}
        seatPriceCents={seatPrice?.unitAmountCents ?? null}
        seatCurrency={seatPrice?.currency ?? "usd"}
        action={updateClientAction}
        client={client}
        submitLabel="Save changes"
      />

      <Card className="mt-6 border-red-200">
        <CardHeader
          title="Remove client"
          description="Cancels this client's seat in Stripe and deletes their settings and captured leads. This cannot be undone."
        />
        <div className="px-5 py-4">
          <form action={deleteClientAction}>
            <input type="hidden" name="clientId" value={client.id} />
            <SubmitButton
              variant="danger"
              pendingLabel="Removing…"
              confirm={`Remove ${client.business_name}? Their seat will be cancelled and their leads deleted.`}
            >
              Remove client
            </SubmitButton>
          </form>
        </div>
      </Card>
    </>
  );
}

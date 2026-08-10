import type { Metadata } from "next";
import Link from "next/link";

import { setClientStatusAction } from "@/actions/clients";
import { SubmitButton } from "@/components/submit-button";
import {
  Alert,
  Card,
  EmptyState,
  PageHeader,
  StatusBadge,
  buttonClasses,
} from "@/components/ui";
import { requireAgency } from "@/lib/agency";
import {
  currentMonthLabel,
  formatMoney,
  formatPhoneNumber,
} from "@/lib/format";
import { trySeatPrice } from "@/lib/seats";
import type { ClientOverview } from "@/types/database";

export const metadata: Metadata = { title: "Clients" };

export default async function ClientsPage() {
  const { supabase, agency } = await requireAgency();

  const [{ data, error }, seatPrice] = await Promise.all([
    supabase
      .from("client_overview")
      .select("*")
      .order("created_at", { ascending: false }),
    trySeatPrice(),
  ]);

  if (error) {
    return (
      <>
        <PageHeader title="Clients" />
        <Alert tone="error">Could not load your clients: {error.message}</Alert>
      </>
    );
  }

  const clients = (data ?? []) as ClientOverview[];
  const activeClients = clients.filter((client) => client.status === "active");

  const leadsThisMonth = clients.reduce(
    (total, client) => total + client.leads_this_month,
    0,
  );
  const monthlyCost =
    seatPrice?.unitAmountCents != null
      ? activeClients.length * seatPrice.unitAmountCents
      : null;
  const monthlyResale = activeClients.reduce(
    (total, client) => total + (client.resale_price_cents ?? 0),
    0,
  );

  return (
    <>
      <PageHeader
        title="Clients"
        description="Every business you resell missed-call text-back to."
        action={
          <Link href="/clients/new" className={buttonClasses("primary")}>
            Add client
          </Link>
        }
      />

      {!agency.has_payment_method && clients.length > 0 ? (
        <Alert tone="warning" className="mb-6">
          No payment method on file, so new client seats cannot be activated.{" "}
          <Link href="/settings/billing" className="font-medium underline">
            Add a card
          </Link>
          .
        </Alert>
      ) : null}

      <div className="mb-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Stat label="Active clients" value={String(activeClients.length)} />
        <Stat
          label={`Leads in ${currentMonthLabel()}`}
          value={String(leadsThisMonth)}
        />
        <Stat
          label="Seat cost / month"
          value={monthlyCost === null ? "—" : formatMoney(monthlyCost, seatPrice?.currency)}
        />
        <Stat
          label="Your resale / month"
          value={
            monthlyResale > 0
              ? formatMoney(monthlyResale, seatPrice?.currency)
              : "—"
          }
        />
      </div>

      <Card>
        {clients.length === 0 ? (
          <EmptyState
            title="No clients yet"
            description="Add the first business you're reselling to. You can pause it any time, and paused clients aren't billed."
            action={
              <Link href="/clients/new" className={buttonClasses("primary")}>
                Add client
              </Link>
            }
          />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead className="border-b border-slate-200 text-xs tracking-wide text-slate-500 uppercase">
                <tr>
                  <th scope="col" className="px-5 py-3 font-medium">
                    Business
                  </th>
                  <th scope="col" className="px-5 py-3 font-medium">
                    Status
                  </th>
                  <th scope="col" className="px-5 py-3 text-right font-medium">
                    Leads this month
                  </th>
                  <th scope="col" className="px-5 py-3 text-right font-medium">
                    Your price
                  </th>
                  <th scope="col" className="px-5 py-3 text-right font-medium">
                    <span className="sr-only">Actions</span>
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {clients.map((client) => (
                  <tr key={client.id} className="hover:bg-slate-50/75">
                    <td className="px-5 py-4">
                      <Link
                        href={`/clients/${client.id}`}
                        className="font-medium text-slate-900 hover:text-brand hover:underline"
                      >
                        {client.business_name}
                      </Link>
                      <div className="mt-0.5 font-mono text-xs text-slate-500">
                        {formatPhoneNumber(client.phone_number)}
                      </div>
                    </td>
                    <td className="px-5 py-4">
                      <StatusBadge status={client.status} />
                      {client.seat_status === "past_due" ? (
                        <div className="mt-1 text-xs font-medium text-amber-700">
                          Payment past due
                        </div>
                      ) : null}
                    </td>
                    <td className="px-5 py-4 text-right">
                      <span className="font-medium text-slate-900">
                        {client.leads_this_month}
                      </span>
                      {client.leads_this_month > 0 ? (
                        <div className="mt-0.5 text-xs text-slate-500">
                          {client.replied_this_month} replied
                        </div>
                      ) : null}
                    </td>
                    <td className="px-5 py-4 text-right text-slate-700">
                      {formatMoney(
                        client.resale_price_cents,
                        seatPrice?.currency,
                      )}
                    </td>
                    <td className="px-5 py-4 text-right">
                      <form
                        action={setClientStatusAction}
                        className="inline-flex"
                      >
                        <input
                          type="hidden"
                          name="clientId"
                          value={client.id}
                        />
                        <input
                          type="hidden"
                          name="status"
                          value={client.status === "active" ? "paused" : "active"}
                        />
                        <SubmitButton variant="secondary" pendingLabel="…">
                          {client.status === "active" ? "Pause" : "Activate"}
                        </SubmitButton>
                      </form>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <Card className="px-5 py-4">
      <p className="text-xs font-medium tracking-wide text-slate-500 uppercase">
        {label}
      </p>
      <p className="mt-1.5 text-2xl font-semibold tracking-tight text-slate-900">
        {value}
      </p>
    </Card>
  );
}

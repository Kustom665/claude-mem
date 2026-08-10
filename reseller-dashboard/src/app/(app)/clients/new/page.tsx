import type { Metadata } from "next";
import Link from "next/link";

import { createClientAction } from "@/actions/clients";
import { ClientForm } from "@/components/client-form";
import { Alert, PageHeader } from "@/components/ui";
import { requireAgency } from "@/lib/agency";
import { supportedTimeZones } from "@/lib/hours";
import { trySeatPrice } from "@/lib/seats";

export const metadata: Metadata = { title: "Add client" };

export default async function NewClientPage() {
  const { agency } = await requireAgency();
  const seatPrice = await trySeatPrice();

  return (
    <>
      <PageHeader
        title="Add client"
        description="An active client takes one paid seat on your card."
      />

      {!agency.has_payment_method ? (
        <Alert tone="warning" className="mb-6">
          You have no payment method on file yet, so this client will be saved
          as paused.{" "}
          <Link href="/settings/billing" className="font-medium underline">
            Add a card
          </Link>{" "}
          to activate seats.
        </Alert>
      ) : null}

      <ClientForm
        agencyName={agency.name}
        timezones={supportedTimeZones()}
        seatPriceCents={seatPrice?.unitAmountCents ?? null}
        seatCurrency={seatPrice?.currency ?? "usd"}
        action={createClientAction}
        submitLabel="Add client"
      />
    </>
  );
}

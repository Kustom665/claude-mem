"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import { requireAgency } from "@/lib/agency";
import { isStripeConfigured } from "@/lib/env";
import { formError, formSuccess, type FormState } from "@/lib/form-state";
import {
  cancelSeatSubscription,
  createSeatSubscription,
  describeStripeError,
} from "@/lib/seats";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import {
  businessHoursFromFormData,
  clientSchema,
  fieldErrors,
  parsePriceToCents,
} from "@/lib/validation";
import type { Agency, Client } from "@/types/database";

/**
 * Client rows are written with the service role rather than the caller's
 * session, because every write also moves Stripe seat billing. `requireAgency`
 * plus an explicit agency_id check is what authorises each one.
 */

type ParsedClient = ReturnType<typeof clientSchema.safeParse>;

function parseClientForm(formData: FormData): ParsedClient | FormState {
  const resalePriceCents = parsePriceToCents(
    String(formData.get("resalePrice") ?? ""),
  );

  if (resalePriceCents === undefined) {
    return formError("Check the highlighted fields.", {
      resalePrice: "Enter an amount like 297 or 297.50.",
    });
  }

  return clientSchema.safeParse({
    businessName: formData.get("businessName"),
    phoneNumber: formData.get("phoneNumber"),
    timezone: formData.get("timezone"),
    hours: businessHoursFromFormData(formData),
    autoReplyMessage: formData.get("autoReplyMessage"),
    status: formData.get("status") === "paused" ? "paused" : "active",
    resalePriceCents,
  });
}

function isFormState(value: ParsedClient | FormState): value is FormState {
  return "ok" in value;
}

function describeWriteError(message: string): string {
  if (message.includes("clients_phone_number_key")) {
    return "That phone number is already assigned to another client.";
  }
  return message;
}

async function loadOwnedClient(
  clientId: string,
  agencyId: string,
): Promise<Client | null> {
  const { data } = await createSupabaseAdminClient()
    .from("clients")
    .select("*")
    .eq("id", clientId)
    .eq("agency_id", agencyId)
    .maybeSingle();

  return (data as Client | null) ?? null;
}

/**
 * Brings Stripe in line with `clients.status`: an active client owns exactly
 * one subscription, a paused one owns none. Returns an error message when the
 * seat could not be started, having already parked the client as paused.
 */
async function reconcileSeat(
  agency: Agency,
  client: Client,
): Promise<string | null> {
  if (!isStripeConfigured()) return null;

  const admin = createSupabaseAdminClient();

  if (client.status === "active" && !client.stripe_subscription_id) {
    if (!agency.has_payment_method) {
      await admin
        .from("clients")
        .update({ status: "paused", seat_status: "none" })
        .eq("id", client.id);

      return "Saved as paused — add a payment method on the Billing page before activating a seat.";
    }

    try {
      const { subscriptionId, seatStatus } = await createSeatSubscription(
        agency,
        client,
      );

      await admin
        .from("clients")
        .update({
          stripe_subscription_id: subscriptionId,
          seat_status: seatStatus,
        })
        .eq("id", client.id);
    } catch (error) {
      await admin
        .from("clients")
        .update({ status: "paused", seat_status: "none" })
        .eq("id", client.id);

      return `Saved as paused — Stripe could not start the seat: ${describeStripeError(error)}`;
    }
  }

  if (client.status === "paused" && client.stripe_subscription_id) {
    await cancelSeatSubscription(client.stripe_subscription_id);

    await admin
      .from("clients")
      .update({ stripe_subscription_id: null, seat_status: "none" })
      .eq("id", client.id);
  }

  return null;
}

export async function createClientAction(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  const { agency } = await requireAgency();

  const parsed = parseClientForm(formData);
  if (isFormState(parsed)) return parsed;
  if (!parsed.success) {
    return formError("Check the highlighted fields.", fieldErrors(parsed.error));
  }

  const input = parsed.data;

  const { data, error } = await createSupabaseAdminClient()
    .from("clients")
    .insert({
      agency_id: agency.id,
      business_name: input.businessName,
      phone_number: input.phoneNumber,
      timezone: input.timezone,
      hours: input.hours,
      auto_reply_message: input.autoReplyMessage,
      status: input.status,
      resale_price_cents: input.resalePriceCents,
    })
    .select("*")
    .single();

  if (error) return formError(describeWriteError(error.message));

  const created = data as Client;
  const seatIssue = await reconcileSeat(agency, created);

  revalidatePath("/dashboard");

  // The client exists either way, so never send the operator back to an empty
  // "add client" form — take them to the saved record and explain the seat.
  if (seatIssue) {
    redirect(`/clients/${created.id}?notice=${encodeURIComponent(seatIssue)}`);
  }

  redirect("/dashboard");
}

export async function updateClientAction(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  const { agency } = await requireAgency();

  const clientId = String(formData.get("clientId") ?? "");
  const existing = await loadOwnedClient(clientId, agency.id);
  if (!existing) return formError("That client no longer exists.");

  const parsed = parseClientForm(formData);
  if (isFormState(parsed)) return parsed;
  if (!parsed.success) {
    return formError("Check the highlighted fields.", fieldErrors(parsed.error));
  }

  const input = parsed.data;

  const { data, error } = await createSupabaseAdminClient()
    .from("clients")
    .update({
      business_name: input.businessName,
      phone_number: input.phoneNumber,
      timezone: input.timezone,
      hours: input.hours,
      auto_reply_message: input.autoReplyMessage,
      status: input.status,
      resale_price_cents: input.resalePriceCents,
    })
    .eq("id", existing.id)
    .eq("agency_id", agency.id)
    .select("*")
    .single();

  if (error) return formError(describeWriteError(error.message));

  const seatIssue = await reconcileSeat(agency, data as Client);

  revalidatePath("/dashboard");
  revalidatePath(`/clients/${existing.id}`);

  return seatIssue ? formError(seatIssue) : formSuccess("Client saved.");
}

/** Pause/activate straight from the client list. */
export async function setClientStatusAction(formData: FormData): Promise<void> {
  const { agency } = await requireAgency();

  const clientId = String(formData.get("clientId") ?? "");
  const status = formData.get("status") === "active" ? "active" : "paused";

  const existing = await loadOwnedClient(clientId, agency.id);
  if (!existing) return;

  const { data, error } = await createSupabaseAdminClient()
    .from("clients")
    .update({ status })
    .eq("id", existing.id)
    .eq("agency_id", agency.id)
    .select("*")
    .single();

  if (error) return;

  await reconcileSeat(agency, data as Client);

  revalidatePath("/dashboard");
  revalidatePath(`/clients/${existing.id}`);
}

export async function deleteClientAction(formData: FormData): Promise<void> {
  const { agency } = await requireAgency();

  const clientId = String(formData.get("clientId") ?? "");
  const existing = await loadOwnedClient(clientId, agency.id);
  if (!existing) redirect("/dashboard");

  // Stop billing before the row (and its subscription id) disappears.
  if (existing.stripe_subscription_id && isStripeConfigured()) {
    await cancelSeatSubscription(existing.stripe_subscription_id);
  }

  await createSupabaseAdminClient()
    .from("clients")
    .delete()
    .eq("id", existing.id)
    .eq("agency_id", agency.id);

  revalidatePath("/dashboard");
  redirect("/dashboard");
}

"use client";

import { useActionState, useState } from "react";

import { SubmitButton } from "@/components/submit-button";
import {
  Alert,
  Card,
  CardHeader,
  Field,
  Input,
  Select,
  Textarea,
} from "@/components/ui";
import { renderAutoReply, smsSenderName } from "@/lib/branding";
import { formatMoney } from "@/lib/format";
import { idleFormState, type FormState } from "@/lib/form-state";
import { DAY_LABELS, DEFAULT_HOURS } from "@/lib/hours";
import { parsePriceToCents } from "@/lib/validation";
import { DAY_KEYS, type BusinessHours, type Client } from "@/types/database";

export const DEFAULT_AUTO_REPLY =
  "Hi! Thanks for calling {{business_name}}. Sorry we missed you — reply to this text and we'll get right back to you.\n— {{sender}}";

type ClientFormProps = {
  agencyName: string;
  timezones: string[];
  seatPriceCents: number | null;
  seatCurrency: string;
  action: (prev: FormState, formData: FormData) => Promise<FormState>;
  client?: Client;
  submitLabel: string;
};

export function ClientForm({
  agencyName,
  timezones,
  seatPriceCents,
  seatCurrency,
  action,
  client,
  submitLabel,
}: ClientFormProps) {
  const [state, formAction] = useActionState(action, idleFormState);

  const [businessName, setBusinessName] = useState(client?.business_name ?? "");
  const [autoReply, setAutoReply] = useState(
    client?.auto_reply_message ?? DEFAULT_AUTO_REPLY,
  );
  const [resalePrice, setResalePrice] = useState(
    client?.resale_price_cents != null
      ? (client.resale_price_cents / 100).toFixed(2).replace(/\.00$/, "")
      : "",
  );

  const hours: BusinessHours = client?.hours ?? DEFAULT_HOURS;
  const resaleCents = parsePriceToCents(resalePrice);
  const margin =
    typeof resaleCents === "number" && seatPriceCents !== null
      ? resaleCents - seatPriceCents
      : null;

  return (
    <form action={formAction} className="space-y-6">
      {client ? <input type="hidden" name="clientId" value={client.id} /> : null}

      {state.ok === false && state.message ? (
        <Alert tone="error">{state.message}</Alert>
      ) : null}
      {state.ok && state.message ? (
        <Alert tone="success">{state.message}</Alert>
      ) : null}

      <Card>
        <CardHeader title="Business" />
        <div className="grid gap-5 px-5 py-5 sm:grid-cols-2">
          <Field
            label="Business name"
            htmlFor="businessName"
            error={state.errors?.businessName}
          >
            <Input
              id="businessName"
              name="businessName"
              value={businessName}
              onChange={(event) => setBusinessName(event.target.value)}
              placeholder="Ridgeline Plumbing"
              maxLength={120}
              required
            />
          </Field>

          <Field
            label="Phone number"
            htmlFor="phoneNumber"
            hint="The number that rings for this business, with country code."
            error={state.errors?.phoneNumber}
          >
            <Input
              id="phoneNumber"
              name="phoneNumber"
              type="tel"
              defaultValue={client?.phone_number ?? ""}
              placeholder="+1 555 010 1234"
              required
            />
          </Field>

          <Field
            label="Timezone"
            htmlFor="timezone"
            hint="Business hours are read in this zone."
            error={state.errors?.timezone}
          >
            <Select
              id="timezone"
              name="timezone"
              defaultValue={client?.timezone ?? "America/New_York"}
            >
              {timezones.map((zone) => (
                <option key={zone} value={zone}>
                  {zone.replace(/_/g, " ")}
                </option>
              ))}
            </Select>
          </Field>

          <Field
            label="Status"
            htmlFor="status"
            hint="Active clients occupy a paid seat. Paused clients keep their settings and cost nothing."
            error={state.errors?.status}
          >
            <Select
              id="status"
              name="status"
              defaultValue={client?.status ?? "active"}
            >
              <option value="active">Active</option>
              <option value="paused">Paused</option>
            </Select>
          </Field>
        </div>
      </Card>

      <Card>
        <CardHeader
          title="Business hours"
          description="Used by the missed-call automation to decide which reply to send."
        />
        <div className="divide-y divide-slate-100 px-5">
          {DAY_KEYS.map((day) => {
            const value = hours[day] ?? DEFAULT_HOURS[day];
            return (
              <div
                key={day}
                className="flex flex-wrap items-center gap-x-4 gap-y-2 py-3"
              >
                <label className="flex w-40 items-center gap-2.5 text-sm text-slate-800">
                  <input
                    type="checkbox"
                    name={`hours.${day}.closed`}
                    value="open"
                    defaultChecked={!value.closed}
                    className="size-4 rounded border-slate-300"
                  />
                  {DAY_LABELS[day]}
                </label>

                <div className="flex items-center gap-2">
                  <Input
                    type="time"
                    aria-label={`${DAY_LABELS[day]} opening time`}
                    name={`hours.${day}.open`}
                    defaultValue={value.open}
                    className="w-32"
                  />
                  <span className="text-sm text-slate-400">to</span>
                  <Input
                    type="time"
                    aria-label={`${DAY_LABELS[day]} closing time`}
                    name={`hours.${day}.close`}
                    defaultValue={value.close}
                    className="w-32"
                  />
                </div>
              </div>
            );
          })}
        </div>
        {state.errors?.hours ? (
          <p className="px-5 pb-4 text-sm text-red-600">{state.errors.hours}</p>
        ) : null}
      </Card>

      <Card>
        <CardHeader
          title="Auto-reply"
          description="Sent to the caller right after a missed call."
        />
        <div className="space-y-4 px-5 py-5">
          <Field
            label="Message"
            htmlFor="autoReplyMessage"
            error={state.errors?.autoReplyMessage}
            hint={
              <>
                Placeholders:{" "}
                <code className="rounded bg-slate-100 px-1 py-0.5 font-mono text-xs">
                  {"{{business_name}}"}
                </code>{" "}
                <code className="rounded bg-slate-100 px-1 py-0.5 font-mono text-xs">
                  {"{{sender}}"}
                </code>{" "}
                <code className="rounded bg-slate-100 px-1 py-0.5 font-mono text-xs">
                  {"{{agency_name}}"}
                </code>
              </>
            }
          >
            <Textarea
              id="autoReplyMessage"
              name="autoReplyMessage"
              rows={4}
              maxLength={1200}
              value={autoReply}
              onChange={(event) => setAutoReply(event.target.value)}
              required
            />
          </Field>

          <div className="rounded-lg bg-slate-50 p-4">
            <p className="text-xs text-slate-500">
              Preview — sent as{" "}
              <span className="font-medium text-slate-700">
                {smsSenderName(agencyName)}
              </span>
            </p>
            <p className="mt-2 rounded-2xl rounded-bl-sm bg-white px-3.5 py-2.5 text-sm whitespace-pre-line text-slate-800 ring-1 ring-slate-200">
              {renderAutoReply(autoReply, {
                agencyName,
                businessName: businessName || "this business",
              })}
            </p>
          </div>
        </div>
      </Card>

      <Card>
        <CardHeader
          title="Your resale price"
          description="What you charge this client. Recorded for your own reference — it is never charged by Stripe."
        />
        <div className="px-5 py-5">
          <Field
            label="Monthly resale price"
            htmlFor="resalePrice"
            error={state.errors?.resalePrice}
            hint={
              seatPriceCents === null ? (
                "Optional."
              ) : (
                <>
                  This seat costs you{" "}
                  <span className="font-medium text-slate-700">
                    {formatMoney(seatPriceCents, seatCurrency)}
                  </span>{" "}
                  per month
                  {margin !== null ? (
                    <>
                      {" · margin "}
                      <span
                        className={
                          margin >= 0
                            ? "font-medium text-emerald-700"
                            : "font-medium text-red-600"
                        }
                      >
                        {formatMoney(margin, seatCurrency)}
                      </span>
                    </>
                  ) : null}
                </>
              )
            }
          >
            <Input
              id="resalePrice"
              name="resalePrice"
              inputMode="decimal"
              value={resalePrice}
              onChange={(event) => setResalePrice(event.target.value)}
              placeholder="297"
              className="max-w-40"
            />
          </Field>
        </div>
      </Card>

      <div className="flex justify-end">
        <SubmitButton pendingLabel="Saving…">{submitLabel}</SubmitButton>
      </div>
    </form>
  );
}

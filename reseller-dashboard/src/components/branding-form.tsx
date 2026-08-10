"use client";

import { useActionState, useState } from "react";

import { LogoUploader } from "@/components/logo-uploader";
import { SubmitButton } from "@/components/submit-button";
import { Alert, Card, CardHeader, Field, Input } from "@/components/ui";
import {
  DEFAULT_PRIMARY_COLOR,
  brandStyle,
  normalizeHexColor,
  renderAutoReply,
  smsSenderName,
} from "@/lib/branding";
import { idleFormState, type FormState } from "@/lib/form-state";
import type { Agency } from "@/types/database";

const PRESET_COLORS = [
  "#4f46e5",
  "#0ea5e9",
  "#0d9488",
  "#16a34a",
  "#ea580c",
  "#dc2626",
  "#db2777",
  "#7c3aed",
  "#0f172a",
];

const SAMPLE_TEMPLATE =
  "Thanks for calling {{business_name}}! Sorry we missed you — reply here and we'll get right back to you.\n— {{sender}}";

const SAMPLE_CLIENT = "Ridgeline Plumbing";

export function BrandingForm({
  agency,
  action,
}: {
  agency: Agency;
  action: (prev: FormState, formData: FormData) => Promise<FormState>;
}) {
  const [state, formAction] = useActionState(action, idleFormState);

  const [name, setName] = useState(agency.name);
  const [color, setColor] = useState(
    normalizeHexColor(agency.primary_color) ?? DEFAULT_PRIMARY_COLOR,
  );
  const [logoUrl, setLogoUrl] = useState(agency.logo_url ?? "");

  const previewColor = normalizeHexColor(color) ?? DEFAULT_PRIMARY_COLOR;
  const sender = smsSenderName(name);

  return (
    <form action={formAction} className="grid gap-6 lg:grid-cols-[1fr_20rem]">
      <div className="space-y-6">
        {state.ok === false && state.message ? (
          <Alert tone="error">{state.message}</Alert>
        ) : null}
        {state.ok && state.message ? (
          <Alert tone="success">{state.message}</Alert>
        ) : null}

        <Card>
          <CardHeader
            title="Identity"
            description="Used across the dashboard and as the name your clients' customers see on every text."
          />
          <div className="space-y-5 px-5 py-5">
            <Field
              label="Business name"
              htmlFor="name"
              error={state.errors?.name}
              hint={`Texts will sign off as “${sender}”.`}
            >
              <Input
                id="name"
                name="name"
                value={name}
                onChange={(event) => setName(event.target.value)}
                maxLength={120}
                required
              />
            </Field>

            <Field label="Logo" error={state.errors?.logoUrl}>
              <LogoUploader
                agencyId={agency.id}
                name="logoUrl"
                value={logoUrl}
                onChange={setLogoUrl}
              />
            </Field>
          </div>
        </Card>

        <Card>
          <CardHeader
            title="Primary colour"
            description="Applied to buttons, links and highlights throughout your dashboard."
          />
          <div className="space-y-5 px-5 py-5">
            <Field label="Colour" htmlFor="primaryColor" error={state.errors?.primaryColor}>
              <div className="flex items-center gap-3">
                <input
                  type="color"
                  aria-label="Pick primary colour"
                  value={previewColor}
                  onChange={(event) => setColor(event.target.value)}
                  className="size-10 cursor-pointer rounded-lg border border-slate-300 bg-white p-1"
                />
                <Input
                  id="primaryColor"
                  name="primaryColor"
                  value={color}
                  onChange={(event) => setColor(event.target.value)}
                  spellCheck={false}
                  className="max-w-40 font-mono"
                  required
                />
              </div>
            </Field>

            <div className="flex flex-wrap gap-2">
              {PRESET_COLORS.map((preset) => (
                <button
                  key={preset}
                  type="button"
                  onClick={() => setColor(preset)}
                  aria-label={`Use ${preset}`}
                  aria-pressed={preset === previewColor}
                  style={{ backgroundColor: preset }}
                  className={
                    preset === previewColor
                      ? "size-8 rounded-full ring-2 ring-slate-900 ring-offset-2"
                      : "size-8 rounded-full ring-1 ring-slate-300"
                  }
                />
              ))}
            </div>
          </div>
        </Card>

        <div className="flex justify-end">
          <SubmitButton pendingLabel="Saving…">Save branding</SubmitButton>
        </div>
      </div>

      <aside style={brandStyle(previewColor)} className="space-y-4 lg:sticky lg:top-10 lg:self-start">
        <Card>
          <CardHeader title="Preview" />
          <div className="space-y-5 px-5 py-5">
            <div>
              <p className="mb-2 text-xs font-medium tracking-wide text-slate-500 uppercase">
                Dashboard
              </p>
              <div className="flex items-center gap-3 rounded-lg border border-slate-200 p-3">
                {logoUrl ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={logoUrl}
                    alt=""
                    className="size-9 rounded-lg object-contain"
                  />
                ) : (
                  <span className="flex size-9 items-center justify-center rounded-lg bg-brand text-sm font-semibold text-brand-fg">
                    {name.trim().charAt(0).toUpperCase() || "A"}
                  </span>
                )}
                <span className="truncate text-sm font-semibold text-slate-900">
                  {name || "Your agency"}
                </span>
              </div>
              <div className="mt-3 flex gap-2">
                <span className="rounded-lg bg-brand px-3 py-1.5 text-sm font-medium text-brand-fg">
                  Add client
                </span>
                <span className="rounded-lg bg-brand-soft px-3 py-1.5 text-sm font-medium text-brand-soft-fg">
                  Clients
                </span>
              </div>
            </div>

            <div>
              <p className="mb-2 text-xs font-medium tracking-wide text-slate-500 uppercase">
                Missed-call text
              </p>
              <p className="text-xs text-slate-500">
                From <span className="font-medium text-slate-700">{sender}</span>
              </p>
              <p className="mt-2 rounded-2xl rounded-bl-sm bg-slate-100 px-3.5 py-2.5 text-sm whitespace-pre-line text-slate-800">
                {renderAutoReply(SAMPLE_TEMPLATE, {
                  agencyName: name || "Your agency",
                  businessName: SAMPLE_CLIENT,
                })}
              </p>
              <p className="mt-2 text-xs text-slate-500">
                Each client sets their own message. Whatever they write,{" "}
                <code className="rounded bg-slate-100 px-1 py-0.5 font-mono text-[11px]">
                  {"{{sender}}"}
                </code>{" "}
                resolves to your business name at send time.
              </p>
            </div>
          </div>
        </Card>
      </aside>
    </form>
  );
}

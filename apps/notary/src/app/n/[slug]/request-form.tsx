'use client';

import { useActionState } from 'react';
import { useFormStatus } from 'react-dom';
import { ActionForm } from '@/components/action-form';
import {
  Button,
  Card,
  CardBody,
  CardHeader,
  Field,
  FormError,
  Input,
  Select,
  Textarea,
} from '@/components/ui';
import {
  CONTACT_PREFERENCES,
  CONTACT_PREFERENCE_LABELS,
  TIME_WINDOWS,
  TIME_WINDOW_LABELS,
  US_STATES,
} from '@/lib/domain';
import { submitRequestAction, type RequestFormState } from './actions';

function SubmitButton() {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" disabled={pending} className="w-full sm:w-auto">
      {pending ? 'Sending…' : 'Send my request'}
    </Button>
  );
}

export function RequestForm({
  slug,
  token,
  services,
  defaultState,
  minDate,
}: {
  slug: string;
  /** Signed when the page was rendered; proves the form came from this page. */
  token: string;
  services: Array<{ key: string; label: string }>;
  defaultState: string;
  /** Earliest date to offer, yyyy-mm-dd. */
  minDate: string;
}) {
  const [state, formAction] = useActionState<RequestFormState, FormData>(
    submitRequestAction.bind(null, slug),
    null,
  );
  const errors = state?.errors ?? {};

  return (
    <ActionForm action={formAction} id="request">
      <Card>
        <CardHeader
          title="Ask for a call back"
          description="Nothing is booked until the notary confirms the time and price with you."
        />
        <CardBody className="space-y-4">
          <FormError message={errors._form} />

          <Field label="Your name" htmlFor="requesterName" error={errors.requesterName} required>
            <Input
              id="requesterName"
              name="requesterName"
              autoComplete="name"
              maxLength={120}
              required
            />
          </Field>

          <div className="grid gap-4 sm:grid-cols-2">
            <Field
              label="Phone"
              htmlFor="requesterPhone"
              error={errors.requesterPhone}
              hint="Give a phone or an email."
            >
              <Input
                id="requesterPhone"
                name="requesterPhone"
                type="tel"
                autoComplete="tel"
                inputMode="tel"
                maxLength={40}
              />
            </Field>
            <Field label="Email" htmlFor="requesterEmail" error={errors.requesterEmail}>
              <Input
                id="requesterEmail"
                name="requesterEmail"
                type="email"
                autoComplete="email"
                maxLength={254}
              />
            </Field>
          </div>

          <Field label="Best way to reach you" htmlFor="preferredContact" error={errors.preferredContact}>
            <Select
              id="preferredContact"
              name="preferredContact"
              defaultValue="ANY"
            >
              {CONTACT_PREFERENCES.map((preference) => (
                <option key={preference} value={preference}>
                  {CONTACT_PREFERENCE_LABELS[preference]}
                </option>
              ))}
            </Select>
          </Field>

          <Field label="What do you need?" htmlFor="service" error={errors.service} required>
            <Select id="service" name="service" defaultValue="" required>
              {services.length > 1 ? (
                <option value="" disabled>
                  Choose one
                </option>
              ) : null}
              {services.map((service) => (
                <option key={service.key} value={service.key}>
                  {service.label}
                </option>
              ))}
            </Select>
          </Field>

          <Field
            label="Which documents?"
            htmlFor="documentSummary"
            error={errors.documentSummary}
            hint="A few words is enough, like “car title” or “mortgage closing”. Please do not type ID numbers, account numbers or anything private."
          >
            <Textarea
              id="documentSummary"
              name="documentSummary"
              maxLength={500}
              className="min-h-16"
            />
          </Field>

          <div className="grid gap-4 sm:grid-cols-3">
            <Field label="People signing" htmlFor="signerCount" error={errors.signerCount}>
              <Input
                id="signerCount"
                name="signerCount"
                type="number"
                inputMode="numeric"
                min={1}
                max={20}
                defaultValue="1"
              />
            </Field>
            <Field label="Preferred day" htmlFor="preferredDate" error={errors.preferredDate}>
              <Input
                id="preferredDate"
                name="preferredDate"
                type="date"
                min={minDate}
              />
            </Field>
            <Field label="Time of day" htmlFor="preferredWindow" error={errors.preferredWindow}>
              <Select
                id="preferredWindow"
                name="preferredWindow"
                defaultValue="FLEXIBLE"
              >
                {TIME_WINDOWS.map((window) => (
                  <option key={window} value={window}>
                    {TIME_WINDOW_LABELS[window]}
                  </option>
                ))}
              </Select>
            </Field>
          </div>

          <fieldset className="space-y-4">
            <legend className="text-sm font-semibold text-[var(--text)]">
              Where should the notary meet you?
            </legend>
            <Field label="Street address" htmlFor="addressLine1" error={errors.addressLine1}>
              <Input
                id="addressLine1"
                name="addressLine1"
                autoComplete="street-address"
                maxLength={200}
              />
            </Field>
            <div className="grid gap-4 sm:grid-cols-6">
              <Field label="City" htmlFor="city" error={errors.city} required className="sm:col-span-3">
                <Input
                  id="city"
                  name="city"
                  autoComplete="address-level2"
                  maxLength={80}
                  required
                />
              </Field>
              <Field label="State" htmlFor="state" error={errors.state} required className="sm:col-span-2">
                <Select
                  id="state"
                  name="state"
                  autoComplete="address-level1"
                  defaultValue={defaultState}
                  required
                >
                  {US_STATES.map(([code, label]) => (
                    <option key={code} value={code}>
                      {label}
                    </option>
                  ))}
                </Select>
              </Field>
              <Field label="ZIP" htmlFor="postalCode" error={errors.postalCode} required>
                <Input
                  id="postalCode"
                  name="postalCode"
                  inputMode="numeric"
                  autoComplete="postal-code"
                  maxLength={10}
                  required
                />
              </Field>
            </div>
          </fieldset>

          <Field label="Anything else?" htmlFor="message" error={errors.message}>
            <Textarea
              id="message"
              name="message"
              maxLength={1000}
              className="min-h-16"
              placeholder="Mobility needs, parking, a deadline, a language you prefer."
            />
          </Field>

          {/*
            The trap for scripts. Nobody sees or reaches this field; anything in it
            means the form was filled in by a program, and the request is dropped.
          */}
          <div
            aria-hidden="true"
            style={{ position: 'absolute', left: '-10000px', width: 1, height: 1, overflow: 'hidden' }}
          >
            <label htmlFor="website">Leave this field empty</label>
            <input id="website" name="website" type="text" tabIndex={-1} autoComplete="off" />
          </div>
          <input type="hidden" name="token" value={token} />

          <div>
            <label className="flex cursor-pointer items-start gap-2.5">
              <input
                type="checkbox"
                name="consent"
                className="focus-ring mt-0.5 h-4 w-4 shrink-0 rounded border-[var(--border-strong)] accent-seal-600"
                required
              />
              <span className="text-sm text-[var(--text)]">
                I am happy for this notary to contact me about this request using the details above.
              </span>
            </label>
            {errors.consent ? (
              <p className="mt-1 text-xs font-medium text-red-600">{errors.consent}</p>
            ) : null}
          </div>

          <div className="flex flex-wrap items-center gap-3">
            <SubmitButton />
            <p className="text-xs text-[var(--text-subtle)]">
              Your details go only to this notary.
            </p>
          </div>
        </CardBody>
      </Card>
    </ActionForm>
  );
}

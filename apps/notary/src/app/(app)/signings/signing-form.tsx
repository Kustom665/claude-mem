'use client';

import { useActionState, useMemo, useState } from 'react';
import { useFormStatus } from 'react-dom';
import {
  Button,
  Card,
  CardBody,
  Checkbox,
  Field,
  Fieldset,
  FormError,
  Input,
  Select,
  Textarea,
} from '@/components/ui';
import {
  SIGNING_STATUSES,
  SIGNING_STATUS_LABELS,
  SIGNING_TYPES,
  SIGNING_TYPE_LABELS,
  US_STATES,
} from '@/lib/domain';
import { centsToInputValue, formatCents } from '@/lib/money';
import type { SigningFormState } from './actions';

export type ClientOption = { id: string; name: string; defaultFeeCents: number | null };

export type SigningFormValues = {
  title: string;
  clientId: string | null;
  type: string;
  status: string;
  scheduledAt: string;
  durationMinutes: number;
  signerName: string | null;
  signerPhone: string | null;
  signerEmail: string | null;
  coSignerName: string | null;
  locationName: string | null;
  addressLine1: string | null;
  addressLine2: string | null;
  city: string | null;
  state: string | null;
  postalCode: string | null;
  loanNumber: string | null;
  escrowNumber: string | null;
  propertyAddress: string | null;
  documentCount: number | null;
  signingFeeCents: number;
  travelFeeCents: number;
  printFeeCents: number;
  additionalFeeCents: number;
  mileageMiles: number;
  scanBacksRequired: boolean;
  shippingCarrier: string | null;
  trackingNumber: string | null;
  docsReturnedAt: string | null;
  notes: string | null;
};

function SubmitButton({ label }: { label: string }) {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" disabled={pending}>
      {pending ? 'Saving…' : label}
    </Button>
  );
}

export function SigningForm({
  action,
  clients,
  values,
  submitLabel,
  mileageRateCents,
}: {
  action: (prev: SigningFormState, formData: FormData) => Promise<SigningFormState>;
  clients: ClientOption[];
  values?: Partial<SigningFormValues>;
  submitLabel: string;
  mileageRateCents: number;
}) {
  const [state, formAction] = useActionState<SigningFormState, FormData>(action, null);
  const errors = state?.errors ?? {};

  const [fees, setFees] = useState({
    signing: centsToInputValue(values?.signingFeeCents) || '',
    travel: centsToInputValue(values?.travelFeeCents) || '',
    print: centsToInputValue(values?.printFeeCents) || '',
    additional: centsToInputValue(values?.additionalFeeCents) || '',
  });
  const [miles, setMiles] = useState(String(values?.mileageMiles ?? ''));

  const totalCents = useMemo(() => {
    return Object.values(fees).reduce((total, value) => {
      const parsed = Number(value.replace(/[$,\s]/g, ''));
      return Number.isFinite(parsed) ? total + Math.round(parsed * 100) : total;
    }, 0);
  }, [fees]);

  const mileageDeductionCents = useMemo(() => {
    const parsed = Number(miles);
    return Number.isFinite(parsed) && parsed > 0 ? Math.round(parsed * mileageRateCents) : 0;
  }, [miles, mileageRateCents]);

  return (
    <form action={formAction} className="space-y-5">
      <FormError message={errors._form} />

      <Card>
        <CardBody className="grid gap-4 sm:grid-cols-2">
          <Field
            label="Title"
            htmlFor="title"
            error={errors.title}
            hint="How you will recognise it in a list."
            required
          >
            <Input
              id="title"
              name="title"
              defaultValue={values?.title ?? ''}
              placeholder="Refi — Martinez"
              required
            />
          </Field>

          <Field label="Client" htmlFor="clientId" error={errors.clientId}>
            <Select id="clientId" name="clientId" defaultValue={values?.clientId ?? ''}>
              <option value="">No client</option>
              {clients.map((client) => (
                <option key={client.id} value={client.id}>
                  {client.name}
                </option>
              ))}
            </Select>
          </Field>

          <Field label="Type" htmlFor="type" error={errors.type} required>
            <Select id="type" name="type" defaultValue={values?.type ?? 'LOAN_SIGNING'} required>
              {SIGNING_TYPES.map((type) => (
                <option key={type} value={type}>
                  {SIGNING_TYPE_LABELS[type]}
                </option>
              ))}
            </Select>
          </Field>

          <Field label="Status" htmlFor="status" error={errors.status} required>
            <Select id="status" name="status" defaultValue={values?.status ?? 'SCHEDULED'} required>
              {SIGNING_STATUSES.map((status) => (
                <option key={status} value={status}>
                  {SIGNING_STATUS_LABELS[status]}
                </option>
              ))}
            </Select>
          </Field>

          <Field label="Scheduled for" htmlFor="scheduledAt" error={errors.scheduledAt} required>
            <Input
              id="scheduledAt"
              name="scheduledAt"
              type="datetime-local"
              defaultValue={values?.scheduledAt ?? ''}
              required
            />
          </Field>

          <Field label="Duration (minutes)" htmlFor="durationMinutes" error={errors.durationMinutes}>
            <Input
              id="durationMinutes"
              name="durationMinutes"
              type="number"
              min={0}
              max={1440}
              step={15}
              defaultValue={values?.durationMinutes ?? 60}
            />
          </Field>
        </CardBody>
      </Card>

      <Card>
        <CardBody>
          <Fieldset legend="Signer and location">
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Signer name" htmlFor="signerName" error={errors.signerName}>
                <Input id="signerName" name="signerName" defaultValue={values?.signerName ?? ''} />
              </Field>
              <Field label="Co-signer" htmlFor="coSignerName" error={errors.coSignerName}>
                <Input
                  id="coSignerName"
                  name="coSignerName"
                  defaultValue={values?.coSignerName ?? ''}
                />
              </Field>
              <Field label="Signer phone" htmlFor="signerPhone" error={errors.signerPhone}>
                <Input
                  id="signerPhone"
                  name="signerPhone"
                  type="tel"
                  defaultValue={values?.signerPhone ?? ''}
                />
              </Field>
              <Field label="Signer email" htmlFor="signerEmail" error={errors.signerEmail}>
                <Input
                  id="signerEmail"
                  name="signerEmail"
                  type="email"
                  defaultValue={values?.signerEmail ?? ''}
                />
              </Field>
              <Field
                label="Location name"
                htmlFor="locationName"
                error={errors.locationName}
                hint="Kitchen table, branch office, hospital room."
              >
                <Input
                  id="locationName"
                  name="locationName"
                  defaultValue={values?.locationName ?? ''}
                />
              </Field>
              <Field label="Address" htmlFor="addressLine1" error={errors.addressLine1}>
                <Input
                  id="addressLine1"
                  name="addressLine1"
                  defaultValue={values?.addressLine1 ?? ''}
                />
              </Field>
              <Field label="City" htmlFor="city" error={errors.city}>
                <Input id="city" name="city" defaultValue={values?.city ?? ''} />
              </Field>
              <div className="grid grid-cols-2 gap-4">
                <Field label="State" htmlFor="state" error={errors.state}>
                  <Select id="state" name="state" defaultValue={values?.state ?? ''}>
                    <option value="">—</option>
                    {US_STATES.map(([code]) => (
                      <option key={code} value={code}>
                        {code}
                      </option>
                    ))}
                  </Select>
                </Field>
                <Field label="ZIP" htmlFor="postalCode" error={errors.postalCode}>
                  <Input
                    id="postalCode"
                    name="postalCode"
                    defaultValue={values?.postalCode ?? ''}
                  />
                </Field>
              </div>
            </div>
          </Fieldset>
        </CardBody>
      </Card>

      <Card>
        <CardBody>
          <Fieldset legend="Loan details" description="Leave blank for general notary work.">
            <div className="grid gap-4 sm:grid-cols-3">
              <Field label="Loan number" htmlFor="loanNumber" error={errors.loanNumber}>
                <Input id="loanNumber" name="loanNumber" defaultValue={values?.loanNumber ?? ''} />
              </Field>
              <Field label="Escrow number" htmlFor="escrowNumber" error={errors.escrowNumber}>
                <Input
                  id="escrowNumber"
                  name="escrowNumber"
                  defaultValue={values?.escrowNumber ?? ''}
                />
              </Field>
              <Field label="Document count" htmlFor="documentCount" error={errors.documentCount}>
                <Input
                  id="documentCount"
                  name="documentCount"
                  type="number"
                  min={0}
                  defaultValue={values?.documentCount ?? ''}
                />
              </Field>
              <Field
                label="Property address"
                htmlFor="propertyAddress"
                error={errors.propertyAddress}
                className="sm:col-span-3"
              >
                <Input
                  id="propertyAddress"
                  name="propertyAddress"
                  defaultValue={values?.propertyAddress ?? ''}
                />
              </Field>
            </div>
          </Fieldset>
        </CardBody>
      </Card>

      <Card>
        <CardBody>
          <Fieldset
            legend="Fees and travel"
            description="Everything here is a non-notarial charge. Per-act notarial fees are recorded in the journal, where the tax exemption is tracked."
          >
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
              <Field label="Signing fee" htmlFor="signingFeeCents" error={errors.signingFeeCents}>
                <Input
                  id="signingFeeCents"
                  name="signingFeeCents"
                  inputMode="decimal"
                  value={fees.signing}
                  onChange={(event) => setFees({ ...fees, signing: event.target.value })}
                  placeholder="150.00"
                />
              </Field>
              <Field label="Travel fee" htmlFor="travelFeeCents" error={errors.travelFeeCents}>
                <Input
                  id="travelFeeCents"
                  name="travelFeeCents"
                  inputMode="decimal"
                  value={fees.travel}
                  onChange={(event) => setFees({ ...fees, travel: event.target.value })}
                />
              </Field>
              <Field label="Printing" htmlFor="printFeeCents" error={errors.printFeeCents}>
                <Input
                  id="printFeeCents"
                  name="printFeeCents"
                  inputMode="decimal"
                  value={fees.print}
                  onChange={(event) => setFees({ ...fees, print: event.target.value })}
                />
              </Field>
              <Field label="Additional" htmlFor="additionalFeeCents" error={errors.additionalFeeCents}>
                <Input
                  id="additionalFeeCents"
                  name="additionalFeeCents"
                  inputMode="decimal"
                  value={fees.additional}
                  onChange={(event) => setFees({ ...fees, additional: event.target.value })}
                />
              </Field>

              <Field
                label="Round-trip miles"
                htmlFor="mileageMiles"
                error={errors.mileageMiles}
                hint={
                  mileageDeductionCents > 0
                    ? `${formatCents(mileageDeductionCents)} deductible at ${(mileageRateCents / 100).toFixed(3)}/mi`
                    : 'Logged to your mileage book automatically.'
                }
              >
                <Input
                  id="mileageMiles"
                  name="mileageMiles"
                  inputMode="decimal"
                  value={miles}
                  onChange={(event) => setMiles(event.target.value)}
                  placeholder="24"
                />
              </Field>

              <div className="flex items-end lg:col-span-3">
                <div className="w-full rounded-lg border border-[var(--border)] bg-[var(--surface-sunken)] px-4 py-2.5">
                  <p className="text-xs font-medium tracking-wide text-[var(--text-muted)] uppercase">
                    Invoice total for this signing
                  </p>
                  <p className="tabular mt-0.5 text-lg font-semibold text-[var(--text)]">
                    {formatCents(totalCents)}
                  </p>
                </div>
              </div>
            </div>
          </Fieldset>
        </CardBody>
      </Card>

      <Card>
        <CardBody>
          <Fieldset legend="Document return">
            <div className="grid gap-4 sm:grid-cols-3">
              <div className="sm:col-span-3">
                <Checkbox
                  name="scanBacksRequired"
                  label="Scan-backs required"
                  defaultChecked={values?.scanBacksRequired ?? false}
                />
              </div>
              <Field label="Carrier" htmlFor="shippingCarrier" error={errors.shippingCarrier}>
                <Input
                  id="shippingCarrier"
                  name="shippingCarrier"
                  defaultValue={values?.shippingCarrier ?? ''}
                  placeholder="FedEx"
                />
              </Field>
              <Field label="Tracking number" htmlFor="trackingNumber" error={errors.trackingNumber}>
                <Input
                  id="trackingNumber"
                  name="trackingNumber"
                  defaultValue={values?.trackingNumber ?? ''}
                />
              </Field>
              <Field label="Docs returned" htmlFor="docsReturnedAt" error={errors.docsReturnedAt}>
                <Input
                  id="docsReturnedAt"
                  name="docsReturnedAt"
                  type="date"
                  defaultValue={values?.docsReturnedAt ?? ''}
                />
              </Field>
              <Field label="Notes" htmlFor="notes" error={errors.notes} className="sm:col-span-3">
                <Textarea id="notes" name="notes" defaultValue={values?.notes ?? ''} />
              </Field>
            </div>
          </Fieldset>
        </CardBody>
      </Card>

      <div className="flex items-center gap-3">
        <SubmitButton label={submitLabel} />
        {state === null && values?.title ? (
          <span className="text-sm text-[var(--text-subtle)]">
            Marking a signing complete fires the signing.completed webhook.
          </span>
        ) : null}
      </div>
    </form>
  );
}

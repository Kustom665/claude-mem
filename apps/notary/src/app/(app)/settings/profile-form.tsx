'use client';

import { useActionState } from 'react';
import { useFormStatus } from 'react-dom';
import {
  Button,
  Card,
  CardBody,
  CardHeader,
  Field,
  FormError,
  Input,
  Select,
} from '@/components/ui';
import { US_STATES } from '@/lib/domain';
import { updateProfileAction, type SettingsFormState } from './actions';

const TIMEZONES = [
  'America/New_York',
  'America/Chicago',
  'America/Denver',
  'America/Phoenix',
  'America/Los_Angeles',
  'America/Anchorage',
  'Pacific/Honolulu',
];

function SubmitButton() {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" disabled={pending}>
      {pending ? 'Saving…' : 'Save profile'}
    </Button>
  );
}

export function ProfileForm({
  values,
  mileageNote,
}: {
  values: {
    name: string;
    businessName: string | null;
    phone: string | null;
    addressLine1: string | null;
    addressLine2: string | null;
    city: string | null;
    state: string | null;
    postalCode: string | null;
    timezone: string;
    mileageRateCents: number;
    invoicePrefix: string;
    invoiceTermsDays: number;
  };
  mileageNote: string;
}) {
  const [state, formAction] = useActionState<SettingsFormState, FormData>(
    updateProfileAction,
    null,
  );
  const errors = state?.errors ?? {};

  return (
    <form action={formAction}>
      <Card>
        <CardHeader title="Business details" description="Appears on your invoices." />
        <CardBody className="grid gap-4 sm:grid-cols-2">
          <FormError message={errors._form} />

          <Field label="Your name" htmlFor="name" error={errors.name} required>
            <Input id="name" name="name" defaultValue={values.name} required />
          </Field>

          <Field label="Business name" htmlFor="businessName" error={errors.businessName}>
            <Input
              id="businessName"
              name="businessName"
              defaultValue={values.businessName ?? ''}
              placeholder="Keystone Mobile Notary"
            />
          </Field>

          <Field label="Phone" htmlFor="phone" error={errors.phone}>
            <Input id="phone" name="phone" type="tel" defaultValue={values.phone ?? ''} />
          </Field>

          <Field label="Address" htmlFor="addressLine1" error={errors.addressLine1}>
            <Input id="addressLine1" name="addressLine1" defaultValue={values.addressLine1 ?? ''} />
          </Field>

          <Field label="Suite / unit" htmlFor="addressLine2" error={errors.addressLine2}>
            <Input id="addressLine2" name="addressLine2" defaultValue={values.addressLine2 ?? ''} />
          </Field>

          <Field label="City" htmlFor="city" error={errors.city}>
            <Input id="city" name="city" defaultValue={values.city ?? ''} />
          </Field>

          <div className="grid grid-cols-2 gap-4">
            <Field label="State" htmlFor="state" error={errors.state}>
              <Select id="state" name="state" defaultValue={values.state ?? ''}>
                <option value="">—</option>
                {US_STATES.map(([code]) => (
                  <option key={code} value={code}>
                    {code}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="ZIP" htmlFor="postalCode" error={errors.postalCode}>
              <Input id="postalCode" name="postalCode" defaultValue={values.postalCode ?? ''} />
            </Field>
          </div>

          <Field label="Timezone" htmlFor="timezone" error={errors.timezone} required>
            <Select id="timezone" name="timezone" defaultValue={values.timezone} required>
              {TIMEZONES.map((zone) => (
                <option key={zone} value={zone}>
                  {zone.replace('America/', '').replace('_', ' ')}
                </option>
              ))}
            </Select>
          </Field>

          <Field
            label="Default mileage rate (¢/mi)"
            htmlFor="mileageRateCents"
            error={errors.mileageRateCents}
            hint={mileageNote}
          >
            <Input
              id="mileageRateCents"
              name="mileageRateCents"
              inputMode="decimal"
              defaultValue={values.mileageRateCents}
            />
          </Field>

          <Field label="Invoice prefix" htmlFor="invoicePrefix" error={errors.invoicePrefix} required>
            <Input id="invoicePrefix" name="invoicePrefix" defaultValue={values.invoicePrefix} required />
          </Field>

          <Field
            label="Default payment terms (days)"
            htmlFor="invoiceTermsDays"
            error={errors.invoiceTermsDays}
          >
            <Input
              id="invoiceTermsDays"
              name="invoiceTermsDays"
              type="number"
              min={0}
              max={365}
              defaultValue={values.invoiceTermsDays}
            />
          </Field>

          <div className="flex items-center gap-3 sm:col-span-2">
            <SubmitButton />
            {state?.saved ? <span className="text-sm text-emerald-600">Saved.</span> : null}
          </div>
        </CardBody>
      </Card>
    </form>
  );
}

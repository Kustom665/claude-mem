'use client';

import { useActionState } from 'react';
import { useFormStatus } from 'react-dom';
import {
  Button,
  Card,
  CardBody,
  Checkbox,
  Field,
  FormError,
  Input,
  Select,
  Textarea,
} from '@/components/ui';
import { CLIENT_TYPES, CLIENT_TYPE_LABELS, US_STATES } from '@/lib/domain';
import { centsToInputValue } from '@/lib/money';
import type { ClientFormState } from './actions';

export type ClientFormValues = {
  name: string;
  type: string;
  contactName: string | null;
  email: string | null;
  phone: string | null;
  addressLine1: string | null;
  addressLine2: string | null;
  city: string | null;
  state: string | null;
  postalCode: string | null;
  defaultFeeCents: number | null;
  paymentTermsDays: number;
  notes: string | null;
  isActive: boolean;
};

function SubmitButton({ label }: { label: string }) {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" disabled={pending}>
      {pending ? 'Saving…' : label}
    </Button>
  );
}

export function ClientForm({
  action,
  values,
  submitLabel,
  saved,
}: {
  action: (prev: ClientFormState, formData: FormData) => Promise<ClientFormState>;
  values?: Partial<ClientFormValues>;
  submitLabel: string;
  saved?: boolean;
}) {
  const [state, formAction] = useActionState<ClientFormState, FormData>(action, null);
  const errors = state?.errors ?? {};
  const showSaved = saved && state === null;

  return (
    <form action={formAction} className="space-y-4">
      <FormError message={errors._form} />

      <Card>
        <CardBody className="grid gap-4 sm:grid-cols-2">
          <Field
            label="Client name"
            htmlFor="name"
            error={errors.name}
            hint="The company that pays you, not the person signing."
            required
          >
            <Input id="name" name="name" defaultValue={values?.name ?? ''} required />
          </Field>

          <Field label="Type" htmlFor="type" error={errors.type} required>
            <Select id="type" name="type" defaultValue={values?.type ?? 'SIGNING_SERVICE'} required>
              {CLIENT_TYPES.map((type) => (
                <option key={type} value={type}>
                  {CLIENT_TYPE_LABELS[type]}
                </option>
              ))}
            </Select>
          </Field>

          <Field label="Contact name" htmlFor="contactName" error={errors.contactName}>
            <Input
              id="contactName"
              name="contactName"
              defaultValue={values?.contactName ?? ''}
              placeholder="Escrow officer or scheduler"
            />
          </Field>

          <Field label="Phone" htmlFor="phone" error={errors.phone}>
            <Input id="phone" name="phone" type="tel" defaultValue={values?.phone ?? ''} />
          </Field>

          <Field label="Email" htmlFor="email" error={errors.email}>
            <Input id="email" name="email" type="email" defaultValue={values?.email ?? ''} />
          </Field>

          <Field
            label="Default fee"
            htmlFor="defaultFeeCents"
            error={errors.defaultFeeCents}
            hint="Pre-fills new signings for this client."
          >
            <Input
              id="defaultFeeCents"
              name="defaultFeeCents"
              inputMode="decimal"
              defaultValue={centsToInputValue(values?.defaultFeeCents)}
              placeholder="150.00"
            />
          </Field>

          <Field label="Address" htmlFor="addressLine1" error={errors.addressLine1}>
            <Input id="addressLine1" name="addressLine1" defaultValue={values?.addressLine1 ?? ''} />
          </Field>

          <Field label="Suite / unit" htmlFor="addressLine2" error={errors.addressLine2}>
            <Input id="addressLine2" name="addressLine2" defaultValue={values?.addressLine2 ?? ''} />
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
              <Input id="postalCode" name="postalCode" defaultValue={values?.postalCode ?? ''} />
            </Field>
          </div>

          <Field
            label="Payment terms (days)"
            htmlFor="paymentTermsDays"
            error={errors.paymentTermsDays}
            hint="Signing services commonly pay in 30. Some take 45."
          >
            <Input
              id="paymentTermsDays"
              name="paymentTermsDays"
              type="number"
              min={0}
              max={365}
              defaultValue={values?.paymentTermsDays ?? 30}
            />
          </Field>

          <Field label="Notes" htmlFor="notes" error={errors.notes} className="sm:col-span-2">
            <Textarea
              id="notes"
              name="notes"
              defaultValue={values?.notes ?? ''}
              placeholder="Scheduling quirks, who to invoice, how quickly they actually pay."
            />
          </Field>

          <div className="sm:col-span-2">
            <Checkbox
              name="isActive"
              label="Active client"
              defaultChecked={values?.isActive ?? true}
              hint="Inactive clients stay in your records but drop out of pickers."
            />
          </div>
        </CardBody>
      </Card>

      <div className="flex items-center gap-3">
        <SubmitButton label={submitLabel} />
        {showSaved ? <span className="text-sm text-emerald-600">Saved.</span> : null}
      </div>
    </form>
  );
}

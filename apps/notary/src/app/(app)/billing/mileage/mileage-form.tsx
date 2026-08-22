'use client';

import { useActionState, useRef } from 'react';
import { useFormStatus } from 'react-dom';
import { Button, Field, FormError, Input, Select, Textarea } from '@/components/ui';
import { createMileageAction, type BillingFormState } from '../actions';

function SubmitButton() {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" disabled={pending} className="w-full">
      {pending ? 'Saving…' : 'Log trip'}
    </Button>
  );
}

export function MileageForm({
  defaultRateCents,
  signings,
}: {
  defaultRateCents: number;
  signings: Array<{ id: string; label: string }>;
}) {
  const formRef = useRef<HTMLFormElement>(null);
  const [state, formAction] = useActionState<BillingFormState, FormData>(
    async (prev, formData) => {
      const result = await createMileageAction(prev, formData);
      if (result === null) formRef.current?.reset();
      return result;
    },
    null,
  );
  const errors = state?.errors ?? {};

  const today = new Date().toISOString().slice(0, 10);

  return (
    <form ref={formRef} action={formAction} className="space-y-3">
      <FormError message={errors._form} />

      <Field label="Date" htmlFor="date" error={errors.date} required>
        <Input id="date" name="date" type="date" defaultValue={today} required />
      </Field>

      <Field label="Purpose" htmlFor="purpose" error={errors.purpose} required>
        <Input id="purpose" name="purpose" placeholder="Drop docs at FedEx" required />
      </Field>

      <div className="grid grid-cols-2 gap-3">
        <Field label="Miles" htmlFor="miles" error={errors.miles} required>
          <Input id="miles" name="miles" inputMode="decimal" placeholder="18.4" required />
        </Field>
        <Field
          label="Rate (¢/mi)"
          htmlFor="ratePerMileCents"
          error={errors.ratePerMileCents}
          hint="IRS rate for today."
        >
          <Input
            id="ratePerMileCents"
            name="ratePerMileCents"
            inputMode="decimal"
            defaultValue={defaultRateCents}
          />
        </Field>
      </div>

      <Field label="From" htmlFor="fromAddress" error={errors.fromAddress}>
        <Input id="fromAddress" name="fromAddress" />
      </Field>

      <Field label="To" htmlFor="toAddress" error={errors.toAddress}>
        <Input id="toAddress" name="toAddress" />
      </Field>

      {signings.length > 0 ? (
        <Field label="Related signing" htmlFor="signingId" error={errors.signingId}>
          <Select id="signingId" name="signingId" defaultValue="">
            <option value="">None</option>
            {signings.map((signing) => (
              <option key={signing.id} value={signing.id}>
                {signing.label}
              </option>
            ))}
          </Select>
        </Field>
      ) : null}

      <Field label="Notes" htmlFor="notes" error={errors.notes}>
        <Textarea id="notes" name="notes" className="min-h-16" />
      </Field>

      <SubmitButton />
    </form>
  );
}

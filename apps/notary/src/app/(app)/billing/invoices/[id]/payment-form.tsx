'use client';

import { useActionState } from 'react';
import { useFormStatus } from 'react-dom';
import { Button, Field, FormError, Input } from '@/components/ui';
import { centsToInputValue, formatCents } from '@/lib/money';
import { recordPaymentAction, type BillingFormState } from '../../actions';

function SubmitButton() {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" disabled={pending} className="w-full">
      {pending ? 'Saving…' : 'Record payment'}
    </Button>
  );
}

export function PaymentForm({
  invoiceId,
  totalCents,
  amountPaidCents,
}: {
  invoiceId: string;
  totalCents: number;
  amountPaidCents: number;
}) {
  const [state, formAction] = useActionState<BillingFormState, FormData>(
    recordPaymentAction.bind(null, invoiceId),
    null,
  );
  const errors = state?.errors ?? {};

  return (
    <form action={formAction} className="space-y-3">
      <FormError message={errors._form} />

      <Field
        label="Total received to date"
        htmlFor="amountPaidCents"
        error={errors.amountPaidCents}
        hint={`Invoice total is ${formatCents(totalCents)}. Enter the cumulative amount, not just this payment.`}
      >
        <Input
          id="amountPaidCents"
          name="amountPaidCents"
          inputMode="decimal"
          defaultValue={centsToInputValue(amountPaidCents)}
        />
      </Field>

      <Field label="Date paid" htmlFor="paidAt" error={errors.paidAt}>
        <Input id="paidAt" name="paidAt" type="date" />
      </Field>

      <SubmitButton />
    </form>
  );
}

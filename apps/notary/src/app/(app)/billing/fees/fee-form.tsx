'use client';

import { useActionState, useRef } from 'react';
import { useFormStatus } from 'react-dom';
import { Button, Checkbox, Field, FormError, Input, Select, Textarea } from '@/components/ui';
import { ACT_TYPES, ACT_TYPE_LABELS, FEE_UNITS, FEE_UNIT_LABELS } from '@/lib/domain';
import { createFeeItemAction, type BillingFormState } from '../actions';

function SubmitButton() {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" disabled={pending} className="w-full">
      {pending ? 'Adding…' : 'Add fee'}
    </Button>
  );
}

export function FeeForm() {
  const formRef = useRef<HTMLFormElement>(null);
  const [state, formAction] = useActionState<BillingFormState, FormData>(
    async (prev, formData) => {
      const result = await createFeeItemAction(prev, formData);
      if (result === null) formRef.current?.reset();
      return result;
    },
    null,
  );
  const errors = state?.errors ?? {};

  return (
    <form ref={formRef} action={formAction} className="space-y-3">
      <FormError message={errors._form} />

      <Field label="Name" htmlFor="name" error={errors.name} required>
        <Input id="name" name="name" placeholder="Apostille courier" required />
      </Field>

      <Field
        label="Notarial act"
        htmlFor="actType"
        error={errors.actType}
        hint="Leave blank for a service fee. Only acts get the tax exemption."
      >
        <Select id="actType" name="actType" defaultValue="">
          <option value="">Not a notarial act</option>
          {ACT_TYPES.map((type) => (
            <option key={type} value={type}>
              {ACT_TYPE_LABELS[type]}
            </option>
          ))}
        </Select>
      </Field>

      <div className="grid grid-cols-2 gap-3">
        <Field label="Your fee" htmlFor="amountCents" error={errors.amountCents} required>
          <Input id="amountCents" name="amountCents" inputMode="decimal" placeholder="5.00" required />
        </Field>
        <Field label="State max" htmlFor="stateMaxCents" error={errors.stateMaxCents}>
          <Input id="stateMaxCents" name="stateMaxCents" inputMode="decimal" />
        </Field>
      </div>

      <Field label="Unit" htmlFor="unit" error={errors.unit} required>
        <Select id="unit" name="unit" defaultValue="PER_ACT" required>
          {FEE_UNITS.map((unit) => (
            <option key={unit} value={unit}>
              {FEE_UNIT_LABELS[unit]}
            </option>
          ))}
        </Select>
      </Field>

      <Field label="Notes" htmlFor="notes" error={errors.notes}>
        <Textarea id="notes" name="notes" className="min-h-16" />
      </Field>

      <Checkbox name="isActive" label="Active" defaultChecked />

      <SubmitButton />
    </form>
  );
}

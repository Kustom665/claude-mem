'use client';

import { useActionState } from 'react';
import { useFormStatus } from 'react-dom';
import { Button, Field, FormError, Input, Select } from '@/components/ui';
import { DEFAULT_STATE } from '@/lib/compliance';
import { US_STATES } from '@/lib/domain';
import { signUpAction, type AuthState } from '../actions';

function SubmitButton() {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" disabled={pending} className="w-full">
      {pending ? 'Creating your account…' : 'Create account'}
    </Button>
  );
}

export function SignUpForm() {
  const [state, formAction] = useActionState<AuthState, FormData>(signUpAction, null);
  const errors = state?.errors ?? {};

  return (
    <form action={formAction} className="space-y-4">
      <FormError message={errors._form} />

      <Field label="Your name" htmlFor="name" error={errors.name} required>
        <Input id="name" name="name" required autoFocus autoComplete="name" />
      </Field>

      <Field label="Email" htmlFor="email" error={errors.email} required>
        <Input id="email" name="email" type="email" autoComplete="email" required />
      </Field>

      <Field
        label="Password"
        htmlFor="password"
        error={errors.password}
        hint="At least 10 characters."
        required
      >
        <Input
          id="password"
          name="password"
          type="password"
          autoComplete="new-password"
          minLength={10}
          required
        />
      </Field>

      <Field
        label="Commission state"
        htmlFor="commissionState"
        error={errors.commissionState}
        hint="Sets your fee caps, journal rules and certificate forms. Changeable later."
        required
      >
        <Select id="commissionState" name="commissionState" defaultValue={DEFAULT_STATE} required>
          {US_STATES.map(([code, label]) => (
            <option key={code} value={code}>
              {label}
            </option>
          ))}
        </Select>
      </Field>

      <SubmitButton />
    </form>
  );
}

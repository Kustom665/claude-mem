'use client';

import { useActionState } from 'react';
import { useFormStatus } from 'react-dom';
import {
  Button,
  Card,
  CardBody,
  CardHeader,
  Checkbox,
  Field,
  FormError,
  Input,
  Select,
  Textarea,
} from '@/components/ui';
import { US_STATES } from '@/lib/domain';
import { centsToInputValue } from '@/lib/money';
import { updateCommissionAction, type SettingsFormState } from '../actions';

function SubmitButton() {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" disabled={pending}>
      {pending ? 'Saving…' : 'Save'}
    </Button>
  );
}

export function CommissionForm({
  values,
  entryCount,
}: {
  values: {
    commissionNumber: string | null;
    commissionState: string;
    commissionCounty: string | null;
    commissionIssuedOn: string;
    commissionExpiresOn: string;
    sealDescription: string | null;
    isSigningAgent: boolean;
    backgroundCheckExpiresOn: string;
    eoPolicyNumber: string | null;
    eoCoverageCents: number | null;
    eoExpiresOn: string;
    bondNumber: string | null;
    bondAmountCents: number | null;
    bondExpiresOn: string;
    journalStartNumber: number;
  };
  entryCount: number;
}) {
  const [state, formAction] = useActionState<SettingsFormState, FormData>(
    updateCommissionAction,
    null,
  );
  const errors = state?.errors ?? {};

  return (
    <form action={formAction} className="space-y-5">
      <FormError message={errors._form} />

      <Card>
        <CardHeader
          title="Commission"
          description="A notarial act performed on an expired commission is void, so this date drives a hard block on new journal entries."
        />
        <CardBody className="grid gap-4 sm:grid-cols-2">
          <Field label="Commission number" htmlFor="commissionNumber" error={errors.commissionNumber}>
            <Input
              id="commissionNumber"
              name="commissionNumber"
              defaultValue={values.commissionNumber ?? ''}
            />
          </Field>

          <Field label="State" htmlFor="commissionState" error={errors.commissionState} required>
            <Select
              id="commissionState"
              name="commissionState"
              defaultValue={values.commissionState}
              required
            >
              {US_STATES.map(([code, label]) => (
                <option key={code} value={code}>
                  {label}
                </option>
              ))}
            </Select>
          </Field>

          <Field label="County" htmlFor="commissionCounty" error={errors.commissionCounty}>
            <Input
              id="commissionCounty"
              name="commissionCounty"
              defaultValue={values.commissionCounty ?? ''}
              placeholder="Allegheny"
            />
          </Field>

          <Field label="Issued on" htmlFor="commissionIssuedOn" error={errors.commissionIssuedOn}>
            <Input
              id="commissionIssuedOn"
              name="commissionIssuedOn"
              type="date"
              defaultValue={values.commissionIssuedOn}
            />
          </Field>

          <Field
            label="Expires on"
            htmlFor="commissionExpiresOn"
            error={errors.commissionExpiresOn}
            hint="Warnings begin 90 days out."
          >
            <Input
              id="commissionExpiresOn"
              name="commissionExpiresOn"
              type="date"
              defaultValue={values.commissionExpiresOn}
            />
          </Field>

          <Field
            label="Starting journal number"
            htmlFor="journalStartNumber"
            error={errors.journalStartNumber}
            hint={
              entryCount > 0
                ? `Locked — ${entryCount} sealed entries already exist.`
                : 'Set this to continue numbering from a previous journal.'
            }
          >
            <Input
              id="journalStartNumber"
              name="journalStartNumber"
              type="number"
              min={1}
              defaultValue={values.journalStartNumber}
              disabled={entryCount > 0}
              readOnly={entryCount > 0}
            />
            {entryCount > 0 ? (
              <input type="hidden" name="journalStartNumber" value={values.journalStartNumber} />
            ) : null}
          </Field>

          <Field
            label="Seal description"
            htmlFor="sealDescription"
            error={errors.sealDescription}
            className="sm:col-span-2"
            hint="What your stamp says, for your own records and for reporting a lost seal."
          >
            <Textarea
              id="sealDescription"
              name="sealDescription"
              className="min-h-16"
              defaultValue={values.sealDescription ?? ''}
            />
          </Field>
        </CardBody>
      </Card>

      <Card>
        <CardHeader
          title="Signing agent credentials"
          description="Required for loan signing work, not for general notary work."
        />
        <CardBody className="grid gap-4 sm:grid-cols-2">
          <div className="sm:col-span-2">
            <Checkbox
              name="isSigningAgent"
              label="I take loan signing work"
              defaultChecked={values.isSigningAgent}
            />
          </div>

          <Field
            label="Background check expires"
            htmlFor="backgroundCheckExpiresOn"
            error={errors.backgroundCheckExpiresOn}
            hint="Most title companies require one renewed annually."
          >
            <Input
              id="backgroundCheckExpiresOn"
              name="backgroundCheckExpiresOn"
              type="date"
              defaultValue={values.backgroundCheckExpiresOn}
            />
          </Field>

          <Field label="E&O policy number" htmlFor="eoPolicyNumber" error={errors.eoPolicyNumber}>
            <Input
              id="eoPolicyNumber"
              name="eoPolicyNumber"
              defaultValue={values.eoPolicyNumber ?? ''}
            />
          </Field>

          <Field label="E&O coverage" htmlFor="eoCoverageCents" error={errors.eoCoverageCents}>
            <Input
              id="eoCoverageCents"
              name="eoCoverageCents"
              inputMode="decimal"
              defaultValue={centsToInputValue(values.eoCoverageCents)}
              placeholder="100000.00"
            />
          </Field>

          <Field label="E&O expires" htmlFor="eoExpiresOn" error={errors.eoExpiresOn}>
            <Input
              id="eoExpiresOn"
              name="eoExpiresOn"
              type="date"
              defaultValue={values.eoExpiresOn}
            />
          </Field>

          <Field label="Bond number" htmlFor="bondNumber" error={errors.bondNumber}>
            <Input id="bondNumber" name="bondNumber" defaultValue={values.bondNumber ?? ''} />
          </Field>

          <Field label="Bond amount" htmlFor="bondAmountCents" error={errors.bondAmountCents}>
            <Input
              id="bondAmountCents"
              name="bondAmountCents"
              inputMode="decimal"
              defaultValue={centsToInputValue(values.bondAmountCents)}
            />
          </Field>

          <Field label="Bond expires" htmlFor="bondExpiresOn" error={errors.bondExpiresOn}>
            <Input
              id="bondExpiresOn"
              name="bondExpiresOn"
              type="date"
              defaultValue={values.bondExpiresOn}
            />
          </Field>
        </CardBody>
      </Card>

      <div className="flex items-center gap-3">
        <SubmitButton />
        {state?.saved ? <span className="text-sm text-emerald-600">Saved.</span> : null}
      </div>
    </form>
  );
}

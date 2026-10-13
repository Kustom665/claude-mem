'use client';

import { useActionState } from 'react';
import { useFormStatus } from 'react-dom';
import { ActionForm } from '@/components/action-form';
import {
  Button,
  Card,
  CardBody,
  Field,
  FormError,
  Input,
  Select,
  Textarea,
} from '@/components/ui';
import {
  PIPELINE_STATUSES,
  PIPELINE_STATUS_LABELS,
  SOURCE_CATEGORIES,
  SOURCE_CATEGORY_LABELS,
} from '@/lib/domain';
import type { ApplicationFormState } from '../actions';

export type ApplicationFormValues = {
  name: string;
  category: string;
  status: string;
  website: string | null;
  contactName: string | null;
  contactEmail: string | null;
  contactPhone: string | null;
  /** yyyy-mm-dd, in the notary's zone, ready for a date input. */
  appliedOn: string;
  lastContactOn: string;
  nextFollowUpOn: string;
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

export function ApplicationForm({
  action,
  values,
  submitLabel,
}: {
  action: (prev: ApplicationFormState, formData: FormData) => Promise<ApplicationFormState>;
  values?: Partial<ApplicationFormValues>;
  submitLabel: string;
}) {
  const [state, formAction] = useActionState<ApplicationFormState, FormData>(action, null);
  const errors = state?.errors ?? {};

  return (
    <ActionForm action={formAction} className="space-y-4">
      <FormError message={errors._form} />

      <Card>
        <CardBody className="grid gap-4 sm:grid-cols-2">
          <Field label="Name" htmlFor="name" error={errors.name} required className="sm:col-span-2">
            <Input
              id="name"
              name="name"
              defaultValue={values?.name ?? ''}
              placeholder="Keystone Title Group"
              required
            />
          </Field>

          <Field label="Type of source" htmlFor="category" error={errors.category} required>
            <Select id="category" name="category" defaultValue={values?.category ?? 'TITLE_ESCROW'} required>
              {SOURCE_CATEGORIES.map((category) => (
                <option key={category} value={category}>
                  {SOURCE_CATEGORY_LABELS[category]}
                </option>
              ))}
            </Select>
          </Field>

          <Field label="Where it stands" htmlFor="status" error={errors.status} required>
            <Select id="status" name="status" defaultValue={values?.status ?? 'RESEARCHING'} required>
              {PIPELINE_STATUSES.map((status) => (
                <option key={status} value={status}>
                  {PIPELINE_STATUS_LABELS[status]}
                </option>
              ))}
            </Select>
          </Field>

          <Field
            label="Website"
            htmlFor="website"
            error={errors.website}
            hint="Their application or vendor page."
            className="sm:col-span-2"
          >
            <Input
              id="website"
              name="website"
              inputMode="url"
              defaultValue={values?.website ?? ''}
              placeholder="example.com/vendors"
            />
          </Field>

          <Field label="Contact name" htmlFor="contactName" error={errors.contactName}>
            <Input
              id="contactName"
              name="contactName"
              defaultValue={values?.contactName ?? ''}
              placeholder="Vendor manager or escrow officer"
            />
          </Field>

          <Field label="Contact phone" htmlFor="contactPhone" error={errors.contactPhone}>
            <Input
              id="contactPhone"
              name="contactPhone"
              type="tel"
              defaultValue={values?.contactPhone ?? ''}
            />
          </Field>

          <Field label="Contact email" htmlFor="contactEmail" error={errors.contactEmail} className="sm:col-span-2">
            <Input
              id="contactEmail"
              name="contactEmail"
              type="email"
              defaultValue={values?.contactEmail ?? ''}
            />
          </Field>

          <Field label="Applied on" htmlFor="appliedOn" error={errors.appliedOn}>
            <Input id="appliedOn" name="appliedOn" type="date" defaultValue={values?.appliedOn ?? ''} />
          </Field>

          <Field label="Last contact" htmlFor="lastContactOn" error={errors.lastContactOn}>
            <Input
              id="lastContactOn"
              name="lastContactOn"
              type="date"
              defaultValue={values?.lastContactOn ?? ''}
            />
          </Field>

          <Field
            label="Follow up on"
            htmlFor="nextFollowUpOn"
            error={errors.nextFollowUpOn}
            hint="Leave blank and one is suggested when you move the status forward."
            className="sm:col-span-2"
          >
            <Input
              id="nextFollowUpOn"
              name="nextFollowUpOn"
              type="date"
              defaultValue={values?.nextFollowUpOn ?? ''}
            />
          </Field>

          <Field label="Notes" htmlFor="notes" error={errors.notes} className="sm:col-span-2">
            <Textarea
              id="notes"
              name="notes"
              defaultValue={values?.notes ?? ''}
              placeholder="Who you spoke to, what they asked for, what they said about fees."
            />
          </Field>
        </CardBody>
      </Card>

      <div className="flex items-center gap-3">
        <SubmitButton label={submitLabel} />
        {state?.saved ? <span className="text-sm text-emerald-600">Saved.</span> : null}
      </div>
    </ActionForm>
  );
}

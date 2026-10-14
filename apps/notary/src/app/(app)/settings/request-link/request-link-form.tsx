'use client';

import { useActionState } from 'react';
import { useFormStatus } from 'react-dom';
import { ActionForm } from '@/components/action-form';
import {
  Button,
  Card,
  CardBody,
  CardHeader,
  Checkbox,
  Field,
  FormError,
  Input,
  Textarea,
} from '@/components/ui';
import { saveRequestLinkAction, type SettingsFormState } from '../actions';

function SubmitButton() {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" disabled={pending}>
      {pending ? 'Saving…' : 'Save request link'}
    </Button>
  );
}

export type RequestLinkValues = {
  publicSlug: string;
  acceptingRequests: boolean;
  publicHeadline: string;
  publicBio: string;
  serviceArea: string;
  servicesOffered: readonly string[];
  requestMinNoticeHours: number;
  showFeesPublicly: boolean;
  showPhonePublicly: boolean;
};

export function RequestLinkForm({
  values,
  origin,
  suggestedSlug,
  services,
  canPublish,
}: {
  values: RequestLinkValues;
  origin: string;
  suggestedSlug: string;
  services: Array<{ key: string; label: string }>;
  canPublish: boolean;
}) {
  const [state, formAction] = useActionState<SettingsFormState, FormData>(
    saveRequestLinkAction,
    null,
  );
  const errors = state?.errors ?? {};
  const offered = new Set(values.servicesOffered);
  const host = origin.replace(/^https?:\/\//, '');

  return (
    <ActionForm action={formAction} className="space-y-5">
      <FormError message={errors._form} />

      <Card>
        <CardHeader
          title="Your link"
          description="The address you share. Letters, numbers and hyphens only."
        />
        <CardBody className="space-y-4">
          <Field
            label="Address"
            htmlFor="publicSlug"
            error={errors.publicSlug}
            hint={
              values.publicSlug
                ? undefined
                : suggestedSlug
                  ? `A suggestion based on your profile: ${suggestedSlug}`
                  : 'Something short people can remember, like your business name.'
            }
          >
            <div className="flex items-stretch">
              <span className="inline-flex shrink-0 items-center rounded-l-lg border border-r-0 border-[var(--border-strong)] bg-[var(--surface-sunken)] px-3 text-sm whitespace-nowrap text-[var(--text-muted)]">
                {host}/n/
              </span>
              <Input
                id="publicSlug"
                name="publicSlug"
                defaultValue={values.publicSlug || suggestedSlug}
                className="min-w-0 flex-1 rounded-l-none"
                autoComplete="off"
                autoCapitalize="none"
                spellCheck={false}
                maxLength={40}
              />
            </div>
          </Field>

          <div>
            <Checkbox
              name="acceptingRequests"
              label="Accept requests through this link"
              defaultChecked={values.acceptingRequests && canPublish}
              hint="Turn off to take the page down without losing your settings. Requests already received stay in your inbox."
            />
            {errors.acceptingRequests ? (
              <p className="mt-1 text-xs font-medium text-red-600">{errors.acceptingRequests}</p>
            ) : null}
          </div>
        </CardBody>
      </Card>

      <Card>
        <CardHeader
          title="What visitors see"
          description="Plain text only. Keep it short: who you are, where you go and how fast you reply."
        />
        <CardBody className="space-y-4">
          <Field label="Headline" htmlFor="publicHeadline" error={errors.publicHeadline}>
            <Input
              id="publicHeadline"
              name="publicHeadline"
              defaultValue={values.publicHeadline}
              placeholder="Mobile notary and loan signing agent"
              maxLength={120}
            />
          </Field>

          <Field
            label="Introduction"
            htmlFor="publicBio"
            error={errors.publicBio}
            hint="Up to 600 characters."
          >
            <Textarea
              id="publicBio"
              name="publicBio"
              defaultValue={values.publicBio}
              maxLength={600}
              placeholder="I come to you: home, office, hospital or care home. Evenings and weekends by arrangement."
            />
          </Field>

          <Field
            label="Where you travel"
            htmlFor="serviceArea"
            error={errors.serviceArea}
            hint="Towns or counties. Visitors outside it can still send a request."
          >
            <Input
              id="serviceArea"
              name="serviceArea"
              defaultValue={values.serviceArea}
              placeholder="Pittsburgh and Allegheny County; Butler and Washington on request"
              maxLength={200}
            />
          </Field>
        </CardBody>
      </Card>

      <Card>
        <CardHeader
          title="What you will take on"
          description="Visitors can only choose from these. Switch off anything you are not set up for."
        />
        <CardBody className="space-y-2.5">
          {services.map((service) => (
            <Checkbox
              key={service.key}
              name="servicesOffered"
              value={service.key}
              label={service.label}
              defaultChecked={offered.has(service.key)}
            />
          ))}
          {errors.servicesOffered ? (
            <p className="text-xs font-medium text-red-600">{errors.servicesOffered}</p>
          ) : null}
        </CardBody>
      </Card>

      <Card>
        <CardHeader title="Notice and privacy" />
        <CardBody className="space-y-4">
          <Field
            label="Notice you like to have, in hours"
            htmlFor="requestMinNoticeHours"
            error={errors.requestMinNoticeHours}
            hint="Shown on your page. When you accept a request with no date, it is scheduled this far ahead."
            className="max-w-xs"
          >
            <Input
              id="requestMinNoticeHours"
              name="requestMinNoticeHours"
              type="number"
              inputMode="numeric"
              min={0}
              max={720}
              step={1}
              defaultValue={values.requestMinNoticeHours}
            />
          </Field>

          <Checkbox
            name="showFeesPublicly"
            label="Show my fee schedule"
            defaultChecked={values.showFeesPublicly}
            hint="Lists your active fees from Billing → Fee schedule. Visitors decide faster when they can see a price."
          />

          <div>
            <Checkbox
              name="showPhonePublicly"
              label="Show my business phone number"
              defaultChecked={values.showPhonePublicly}
              hint="Off by default. Anyone, including bots, can read a number shown on a public page."
            />
            {errors.showPhonePublicly ? (
              <p className="mt-1 text-xs font-medium text-red-600">{errors.showPhonePublicly}</p>
            ) : null}
          </div>

          <div className="flex items-center gap-3 border-t border-[var(--border)] pt-4">
            <SubmitButton />
            {state?.saved ? <span className="text-sm text-emerald-600">Saved.</span> : null}
          </div>
        </CardBody>
      </Card>
    </ActionForm>
  );
}

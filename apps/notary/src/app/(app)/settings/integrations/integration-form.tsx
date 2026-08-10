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
} from '@/components/ui';
import { saveIntegrationAction, type SettingsFormState } from '../actions';

function SubmitButton() {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" disabled={pending}>
      {pending ? 'Saving…' : 'Save integration'}
    </Button>
  );
}

export function IntegrationForm({
  values,
  events,
}: {
  values: { webhookUrl: string; enabled: boolean; subscribed: string[] };
  events: Array<{ key: string; label: string; use: string }>;
}) {
  const [state, formAction] = useActionState<SettingsFormState, FormData>(
    saveIntegrationAction,
    null,
  );
  const errors = state?.errors ?? {};
  const subscribed = new Set(values.subscribed);

  return (
    <form action={formAction}>
      <Card>
        <CardHeader
          title="GoHighLevel webhook"
          description="Point this at an Inbound Webhook trigger in a GHL workflow."
        />
        <CardBody className="space-y-4">
          <FormError message={errors._form} />

          <Field
            label="Webhook URL"
            htmlFor="webhookUrl"
            error={errors.webhookUrl}
            hint="Must be https. Treat it as a secret — anyone with the URL can post to your workflow."
          >
            <Input
              id="webhookUrl"
              name="webhookUrl"
              type="url"
              defaultValue={values.webhookUrl}
              placeholder="https://services.leadconnectorhq.com/hooks/…"
            />
          </Field>

          <Checkbox
            name="enabled"
            label="Send events"
            defaultChecked={values.enabled}
            hint="Turn off to pause delivery without losing your configuration."
          />

          <fieldset>
            <legend className="mb-2 text-sm font-semibold text-[var(--text)]">Events</legend>
            <div className="space-y-2.5">
              {events.map((event) => (
                <Checkbox
                  key={event.key}
                  name="events"
                  value={event.key}
                  label={event.label}
                  hint={event.use}
                  defaultChecked={subscribed.has(event.key)}
                />
              ))}
            </div>
          </fieldset>

          <div className="flex items-center gap-3">
            <SubmitButton />
            {state?.saved ? <span className="text-sm text-emerald-600">Saved.</span> : null}
          </div>
        </CardBody>
      </Card>
    </form>
  );
}

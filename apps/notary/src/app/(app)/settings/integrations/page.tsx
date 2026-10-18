import type { Metadata } from 'next';
import { requireUser } from '@/lib/auth';
import { prisma } from '@/lib/db';
import { formatDateTime } from '@/lib/dates';
import {
  SIGNATURE_VERIFICATION_SNIPPET,
  WEBHOOK_EVENTS,
  WEBHOOK_EVENT_LABELS,
  WEBHOOK_EVENT_USES,
} from '@/lib/webhooks';
import {
  Alert,
  Badge,
  Card,
  CardBody,
  CardHeader,
  EmptyState,
  PageHeader,
  Table,
  Td,
  Th,
} from '@/components/ui';
import { SettingsTabs } from '../tabs';
import { IntegrationForm } from './integration-form';
import { RetryDeliveryButton, RotateSecretButton, TestWebhookButton } from './buttons';

export const metadata: Metadata = { title: 'Integrations' };

export default async function IntegrationsPage() {
  const user = await requireUser();

  const integration = await prisma.integration.findFirst({
    where: { userId: user.id, provider: 'GOHIGHLEVEL' },
  });

  const deliveries = await prisma.webhookDelivery.findMany({
    where: { userId: user.id },
    orderBy: { createdAt: 'desc' },
    take: 25,
  });

  const subscribed = new Set(
    (integration?.subscribedEvents ?? WEBHOOK_EVENTS.join(',')).split(','),
  );

  return (
    <>
      <PageHeader
        title="Integrations"
        description="Push business events to GoHighLevel — or any automation platform that accepts a webhook."
      />
      <SettingsTabs active="integrations" />

      <div className="max-w-4xl space-y-5">
        <Alert tone="info" title="What lives where">
          This app owns the notary record: the journal, the acts, the fees, the compliance state.
          It deliberately is not a CRM. Every meaningful business event is pushed out to your
          automation platform, which owns pipelines, SMS and email nurture, review requests and
          rebooking. Building a second-rate CRM inside a compliance tool helps nobody — GoHighLevel
          already does that part well.
        </Alert>

        <IntegrationForm
          values={{
            webhookUrl: integration?.webhookUrl ?? '',
            enabled: integration?.enabled ?? false,
            subscribed: [...subscribed],
          }}
          events={WEBHOOK_EVENTS.map((event) => ({
            key: event,
            label: WEBHOOK_EVENT_LABELS[event],
            use: WEBHOOK_EVENT_USES[event],
          }))}
        />

        {integration ? (
          <Card>
            <CardHeader
              title="Signing secret"
              description="Deliveries are signed with HMAC-SHA256 so the receiver can prove they came from you."
              actions={<RotateSecretButton />}
            />
            <CardBody className="space-y-3">
              <div className="rounded-lg border border-[var(--border)] bg-[var(--surface-sunken)] p-3">
                <p className="font-mono text-xs break-all text-[var(--text)]">
                  {integration.webhookSecret ?? '—'}
                </p>
              </div>
              <p className="text-xs leading-relaxed text-[var(--text-subtle)]">
                Each request carries <code>x-notarydesk-signature</code> and{' '}
                <code>x-notarydesk-timestamp</code>. GoHighLevel&rsquo;s inbound webhook step
                cannot compute an HMAC, so a direct GHL setup relies on the URL staying secret —
                which is usually acceptable. If you put a small function in front of it, verify
                like this:
              </p>
              <pre className="overflow-x-auto rounded-lg border border-[var(--border)] bg-[var(--surface-sunken)] p-3 font-mono text-[11px] leading-relaxed text-[var(--text)]">
                {SIGNATURE_VERIFICATION_SNIPPET}
              </pre>
              <div className="flex items-center gap-3 pt-1">
                <TestWebhookButton disabled={!integration.webhookUrl} />
                {integration.lastDeliveryAt ? (
                  <span className="text-xs text-[var(--text-subtle)]">
                    Last delivery {formatDateTime(integration.lastDeliveryAt, user.timezone)} —{' '}
                    {integration.lastDeliveryStatus}
                  </span>
                ) : null}
              </div>
            </CardBody>
          </Card>
        ) : null}

        <Card>
          <CardHeader title="Delivery log" description="The last 25 attempts." />
          {deliveries.length === 0 ? (
            <EmptyState
              title="No deliveries yet"
              description="Save a webhook URL, enable delivery, then send a test."
            />
          ) : (
            <Table>
              <thead>
                <tr>
                  <Th>When</Th>
                  <Th>Event</Th>
                  <Th>Status</Th>
                  <Th>Detail</Th>
                  <Th />
                </tr>
              </thead>
              <tbody>
                {deliveries.map((delivery) => (
                  <tr key={delivery.id}>
                    <Td className="whitespace-nowrap text-[var(--text-muted)]">
                      {formatDateTime(delivery.createdAt, user.timezone)}
                    </Td>
                    <Td className="font-mono text-xs">{delivery.event}</Td>
                    <Td>
                      <Badge
                        tone={
                          delivery.status === 'SUCCESS'
                            ? 'success'
                            : delivery.status === 'FAILED'
                              ? 'danger'
                              : 'neutral'
                        }
                      >
                        {delivery.status}
                        {delivery.statusCode ? ` ${delivery.statusCode}` : ''}
                      </Badge>
                    </Td>
                    <Td className="text-xs text-[var(--text-muted)]">
                      {delivery.error ?? delivery.responseBody?.slice(0, 80) ?? '—'}
                      {delivery.attempts > 1 ? (
                        <span className="block text-[var(--text-subtle)]">
                          {delivery.attempts} attempts
                        </span>
                      ) : null}
                    </Td>
                    <Td align="right">
                      {delivery.status === 'FAILED' ? (
                        <RetryDeliveryButton deliveryId={delivery.id} />
                      ) : null}
                    </Td>
                  </tr>
                ))}
              </tbody>
            </Table>
          )}
        </Card>

        <Card>
          <CardHeader title="Setting this up in GoHighLevel" />
          <CardBody>
            <ol className="list-inside list-decimal space-y-2 text-sm leading-relaxed text-[var(--text-muted)]">
              <li>
                In GoHighLevel, create a workflow and add an <strong>Inbound Webhook</strong>{' '}
                trigger. Copy the URL it gives you.
              </li>
              <li>Paste that URL above, choose your events, and enable delivery.</li>
              <li>
                Send a test. GoHighLevel will capture the sample payload and let you map its fields.
              </li>
              <li>
                Branch on the <code>event</code> field so one workflow can handle several event
                types, or create a separate workflow per event and subscribe each to just one.
              </li>
              <li>
                Map <code>data.signerName</code>, <code>data.signerPhone</code> and{' '}
                <code>data.signerEmail</code> to a contact, then build your nurture from there.
              </li>
            </ol>
          </CardBody>
        </Card>
      </div>
    </>
  );
}

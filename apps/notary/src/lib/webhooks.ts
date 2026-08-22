import 'server-only';

import { createHmac } from 'node:crypto';
import { prisma } from './db';

/**
 * Outbound webhooks — the handoff to GoHighLevel.
 *
 * Division of labour: this app owns the notary record of truth (journal, acts,
 * fees, compliance state) and pushes business events outward. The automation
 * platform owns everything downstream — pipelines, SMS and email nurture,
 * review requests, rebooking campaigns. Nothing in here tries to be a CRM,
 * because a CRM is the one part of this product that is genuinely a commodity.
 *
 * Deliveries are signed so the receiving workflow can verify they came from
 * this app, logged so a failure is visible, and replayable so a GHL outage does
 * not silently lose a signing.
 */

export const WEBHOOK_EVENTS = [
  'signing.scheduled',
  'signing.completed',
  'signing.cancelled',
  'client.created',
  'invoice.sent',
  'invoice.paid',
  'journal.entry_created',
  'compliance.expiring',
] as const;

export type WebhookEvent = (typeof WEBHOOK_EVENTS)[number];

export const WEBHOOK_EVENT_LABELS: Record<WebhookEvent, string> = {
  'signing.scheduled': 'Signing scheduled',
  'signing.completed': 'Signing completed',
  'signing.cancelled': 'Signing cancelled',
  'client.created': 'Client created',
  'invoice.sent': 'Invoice sent',
  'invoice.paid': 'Invoice paid',
  'journal.entry_created': 'Journal entry recorded',
  'compliance.expiring': 'Credential expiring',
};

/** What each event is useful for once it reaches an automation platform. */
export const WEBHOOK_EVENT_USES: Record<WebhookEvent, string> = {
  'signing.scheduled': 'Send the signer a confirmation text and a calendar invite.',
  'signing.completed': 'Trigger the review request and the "refer a friend" follow-up.',
  'signing.cancelled': 'Move the opportunity back to the rebooking pipeline.',
  'client.created': 'Add the title company or escrow officer to the nurture sequence.',
  'invoice.sent': 'Start the payment reminder sequence.',
  'invoice.paid': 'Stop reminders and fire the thank-you.',
  'journal.entry_created': 'Feed act counts into a reporting dashboard.',
  'compliance.expiring': 'Alert the notary before a commission or E&O policy lapses.',
};

const DELIVERY_TIMEOUT_MS = 10_000;

export type WebhookPayload = {
  event: WebhookEvent;
  sentAt: string;
  data: Record<string, unknown>;
};

/**
 * Sign a payload body.
 *
 * Exported so the receiving side — and the tests — can reproduce the value.
 * The timestamp is signed alongside the body so a captured delivery cannot be
 * replayed indefinitely.
 */
export function signPayload(secret: string, timestamp: string, body: string): string {
  return createHmac('sha256', secret).update(`${timestamp}.${body}`).digest('hex');
}

/**
 * Queue and attempt a delivery.
 *
 * Never throws: a webhook failure must not roll back the journal entry or the
 * signing that triggered it. Failures land in the delivery log for retry.
 */
export async function dispatchEvent(
  userId: string,
  event: WebhookEvent,
  data: Record<string, unknown>,
): Promise<void> {
  try {
    const integration = await prisma.integration.findFirst({
      where: { userId, enabled: true },
    });

    if (!integration?.webhookUrl) return;
    if (!integration.subscribedEvents.split(',').includes(event)) return;

    const payload: WebhookPayload = {
      event,
      sentAt: new Date().toISOString(),
      data,
    };
    const body = JSON.stringify(payload);

    const delivery = await prisma.webhookDelivery.create({
      data: { userId, integrationId: integration.id, event, payload: body },
    });

    await attemptDelivery(delivery.id, integration.webhookUrl, integration.webhookSecret, body);
  } catch {
    // Swallow: the caller's work is already committed and matters more than
    // the notification. The delivery log is the record of what failed.
  }
}

/** Send one delivery and record the outcome. Also used by manual retry. */
export async function attemptDelivery(
  deliveryId: string,
  url: string,
  secret: string | null,
  body: string,
): Promise<boolean> {
  const timestamp = Math.floor(Date.now() / 1000).toString();
  const headers: Record<string, string> = {
    'content-type': 'application/json',
    'user-agent': 'NotaryDesk-Webhook/1',
    'x-notarydesk-delivery': deliveryId,
    'x-notarydesk-timestamp': timestamp,
  };
  if (secret) {
    headers['x-notarydesk-signature'] = `sha256=${signPayload(secret, timestamp, body)}`;
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), DELIVERY_TIMEOUT_MS);

  try {
    const response = await fetch(url, {
      method: 'POST',
      headers,
      body,
      signal: controller.signal,
    });

    const responseBody = (await response.text().catch(() => '')).slice(0, 1000);
    const ok = response.ok;

    await recordOutcome(deliveryId, {
      status: ok ? 'SUCCESS' : 'FAILED',
      statusCode: response.status,
      responseBody,
      error: ok ? null : `Receiver returned ${response.status}.`,
    });

    return ok;
  } catch (error) {
    await recordOutcome(deliveryId, {
      status: 'FAILED',
      statusCode: null,
      responseBody: null,
      error:
        error instanceof Error && error.name === 'AbortError'
          ? `No response within ${DELIVERY_TIMEOUT_MS / 1000}s.`
          : error instanceof Error
            ? error.message
            : 'Delivery failed.',
    });
    return false;
  } finally {
    clearTimeout(timer);
  }
}

async function recordOutcome(
  deliveryId: string,
  outcome: {
    status: 'SUCCESS' | 'FAILED';
    statusCode: number | null;
    responseBody: string | null;
    error: string | null;
  },
): Promise<void> {
  const delivery = await prisma.webhookDelivery
    .update({
      where: { id: deliveryId },
      data: {
        status: outcome.status,
        statusCode: outcome.statusCode,
        responseBody: outcome.responseBody,
        error: outcome.error,
        attempts: { increment: 1 },
        deliveredAt: outcome.status === 'SUCCESS' ? new Date() : null,
      },
      select: { integrationId: true },
    })
    .catch(() => null);

  if (delivery) {
    await prisma.integration
      .update({
        where: { id: delivery.integrationId },
        data: { lastDeliveryAt: new Date(), lastDeliveryStatus: outcome.status },
      })
      .catch(() => null);
  }
}

/**
 * Verification snippet handed to the user for the receiving end.
 *
 * GoHighLevel's inbound webhook step cannot compute an HMAC, so a notary using
 * GHL directly will rely on the URL's secrecy. The snippet is for anyone
 * putting a small function in front of it, which is the setup worth
 * recommending once real money moves through the automations.
 */
export const SIGNATURE_VERIFICATION_SNIPPET = `// Verify a Notary Desk webhook (Node)
import { createHmac, timingSafeEqual } from 'node:crypto';

export function isValid(req, secret) {
  const timestamp = req.headers['x-notarydesk-timestamp'];
  const signature = req.headers['x-notarydesk-signature'];
  if (!timestamp || !signature) return false;

  // Reject anything older than five minutes.
  if (Math.abs(Date.now() / 1000 - Number(timestamp)) > 300) return false;

  const expected = 'sha256=' + createHmac('sha256', secret)
    .update(timestamp + '.' + req.rawBody)
    .digest('hex');

  const a = Buffer.from(signature);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}`;

'use server';

import { randomBytes } from 'node:crypto';
import { revalidatePath } from 'next/cache';
import { requireUser, destroyAllSessions } from '@/lib/auth';
import { prisma } from '@/lib/db';
import { attemptDelivery, WEBHOOK_EVENTS, type WebhookEvent } from '@/lib/webhooks';
import {
  commissionSchema,
  formDataToObject,
  profileSchema,
  toFieldErrors,
  type FieldErrors,
} from '@/lib/validation';

export type SettingsFormState = { errors: FieldErrors; saved?: boolean } | null;

export async function updateProfileAction(
  _prev: SettingsFormState,
  formData: FormData,
): Promise<SettingsFormState> {
  const user = await requireUser();

  const parsed = profileSchema.safeParse(formDataToObject(formData));
  if (!parsed.success) return { errors: toFieldErrors(parsed.error) };

  await prisma.user.update({ where: { id: user.id }, data: parsed.data });

  revalidatePath('/settings');
  return { errors: {}, saved: true };
}

export async function updateCommissionAction(
  _prev: SettingsFormState,
  formData: FormData,
): Promise<SettingsFormState> {
  const user = await requireUser();

  const parsed = commissionSchema.safeParse(formDataToObject(formData));
  if (!parsed.success) return { errors: toFieldErrors(parsed.error) };

  const data = parsed.data;

  // Changing the journal start number after entries exist would renumber a
  // sealed journal, which is exactly what a sequential journal must never do.
  const existingEntries = await prisma.journalEntry.count({ where: { userId: user.id } });
  if (existingEntries > 0 && data.journalStartNumber !== user.journalStartNumber) {
    return {
      errors: {
        journalStartNumber:
          'Your journal already has sealed entries, so its starting number is fixed. Changing it ' +
          'would break the sequence a journal is required to keep.',
      },
    };
  }

  await prisma.user.update({ where: { id: user.id }, data });

  revalidatePath('/settings/commission');
  revalidatePath('/dashboard');
  return { errors: {}, saved: true };
}

export async function signOutEverywhereAction(): Promise<void> {
  const user = await requireUser();
  await destroyAllSessions(user.id);
  revalidatePath('/settings');
}

// ---------------------------------------------------------------------------
// Integrations
// ---------------------------------------------------------------------------

export async function saveIntegrationAction(
  _prev: SettingsFormState,
  formData: FormData,
): Promise<SettingsFormState> {
  const user = await requireUser();

  const webhookUrl = String(formData.get('webhookUrl') ?? '').trim();
  const enabled = formData.get('enabled') === 'on';
  const events = formData.getAll('events').map(String).filter(isWebhookEvent);

  if (webhookUrl) {
    let parsedUrl: URL;
    try {
      parsedUrl = new URL(webhookUrl);
    } catch {
      return { errors: { webhookUrl: 'Enter a complete URL, including https://' } };
    }
    if (parsedUrl.protocol !== 'https:') {
      return {
        errors: {
          webhookUrl:
            'Use an https:// URL. Signing data would travel in clear text over plain http.',
        },
      };
    }
  }

  if (enabled && !webhookUrl) {
    return { errors: { webhookUrl: 'Add a webhook URL before enabling delivery.' } };
  }

  const existing = await prisma.integration.findFirst({
    where: { userId: user.id, provider: 'GOHIGHLEVEL' },
    select: { id: true, webhookSecret: true },
  });

  const subscribedEvents = (events.length > 0 ? events : WEBHOOK_EVENTS).join(',');

  if (existing) {
    await prisma.integration.update({
      where: { id: existing.id },
      data: { webhookUrl: webhookUrl || null, enabled, subscribedEvents },
    });
  } else {
    await prisma.integration.create({
      data: {
        userId: user.id,
        provider: 'GOHIGHLEVEL',
        webhookUrl: webhookUrl || null,
        enabled,
        subscribedEvents,
        webhookSecret: randomBytes(24).toString('base64url'),
      },
    });
  }

  revalidatePath('/settings/integrations');
  return { errors: {}, saved: true };
}

export async function rotateWebhookSecretAction(): Promise<void> {
  const user = await requireUser();
  await prisma.integration.updateMany({
    where: { userId: user.id, provider: 'GOHIGHLEVEL' },
    data: { webhookSecret: randomBytes(24).toString('base64url') },
  });
  revalidatePath('/settings/integrations');
}

/**
 * Send a test delivery.
 *
 * Uses the real dispatch path rather than a special-cased one, so a test that
 * succeeds proves the actual integration works — including the signature.
 */
export async function sendTestWebhookAction(): Promise<void> {
  const user = await requireUser();

  const integration = await prisma.integration.findFirst({
    where: { userId: user.id, provider: 'GOHIGHLEVEL' },
  });
  if (!integration?.webhookUrl) return;

  const body = JSON.stringify({
    event: 'signing.completed',
    sentAt: new Date().toISOString(),
    test: true,
    data: {
      signingId: 'test_signing',
      title: 'Test signing — refinance',
      status: 'COMPLETED',
      signerName: 'Jordan Avery',
      signerPhone: '+15551234567',
      signerEmail: 'jordan.avery@example.com',
      totalFeeCents: 17500,
    },
  });

  const delivery = await prisma.webhookDelivery.create({
    data: {
      userId: user.id,
      integrationId: integration.id,
      event: 'signing.completed',
      payload: body,
    },
  });

  await attemptDelivery(delivery.id, integration.webhookUrl, integration.webhookSecret, body);

  revalidatePath('/settings/integrations');
}

export async function retryDeliveryAction(deliveryId: string): Promise<void> {
  const user = await requireUser();

  const delivery = await prisma.webhookDelivery.findFirst({
    where: { id: deliveryId, userId: user.id },
    include: { integration: true },
  });
  if (!delivery?.integration.webhookUrl) return;

  await attemptDelivery(
    delivery.id,
    delivery.integration.webhookUrl,
    delivery.integration.webhookSecret,
    delivery.payload,
  );

  revalidatePath('/settings/integrations');
}

function isWebhookEvent(value: string): value is WebhookEvent {
  return (WEBHOOK_EVENTS as readonly string[]).includes(value);
}

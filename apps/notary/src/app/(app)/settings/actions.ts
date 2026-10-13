'use server';

import { randomBytes } from 'node:crypto';
import { revalidatePath } from 'next/cache';
import { requireUser, destroyAllSessions } from '@/lib/auth';
import { prisma } from '@/lib/db';
import { isUniqueViolation } from '@/lib/db-errors';
import { checkCanPublish, requestPath, serializeServicesOffered } from '@/lib/request-link';
import { attemptDelivery, WEBHOOK_EVENTS, type WebhookEvent } from '@/lib/webhooks';
import {
  commissionSchema,
  formDataToObject,
  profileSchema,
  requestLinkSchema,
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

  const parsed = commissionSchema.safeParse(formDataToObject(formData, user.timezone));
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

// ---------------------------------------------------------------------------
// Public request link
// ---------------------------------------------------------------------------

const SLUG_TAKEN = 'That address is already taken. Try adding your city or a number.';

export async function saveRequestLinkAction(
  _prev: SettingsFormState,
  formData: FormData,
): Promise<SettingsFormState> {
  const user = await requireUser();

  // Checkboxes that share a name arrive as repeated keys, and formDataToObject
  // keeps only the last of them, so gather the services here.
  const raw = formDataToObject(formData);
  raw.servicesOffered = formData.getAll('servicesOffered').map(String).join(',');

  const parsed = requestLinkSchema.safeParse(raw);
  if (!parsed.success) return { errors: toFieldErrors(parsed.error) };
  const data = parsed.data;

  // Only a notary with a commission on file and in date may put a public page up.
  if (data.acceptingRequests) {
    const check = checkCanPublish(user);
    if (!check.ok) return { errors: { acceptingRequests: check.reason } };
  }

  if (data.showPhonePublicly && !user.phone) {
    return {
      errors: {
        showPhonePublicly: 'Add a business phone number to your profile first, then show it here.',
      },
    };
  }

  if (data.publicSlug) {
    const taken = await prisma.user.findFirst({
      where: { publicSlug: data.publicSlug, id: { not: user.id } },
      select: { id: true },
    });
    if (taken) return { errors: { publicSlug: SLUG_TAKEN } };
  }

  try {
    await prisma.user.update({
      where: { id: user.id },
      data: {
        publicSlug: data.publicSlug,
        acceptingRequests: data.acceptingRequests,
        publicHeadline: data.publicHeadline,
        publicBio: data.publicBio,
        serviceArea: data.serviceArea,
        servicesOffered: serializeServicesOffered(data.servicesOffered),
        requestMinNoticeHours: data.requestMinNoticeHours,
        showFeesPublicly: data.showFeesPublicly,
        showPhonePublicly: data.showPhonePublicly,
      },
    });
  } catch (error) {
    // Two people claiming the same address in the same moment: the unique index
    // decides, and the loser is told rather than shown an error page.
    if (isUniqueViolation(error)) return { errors: { publicSlug: SLUG_TAKEN } };
    throw error;
  }

  revalidatePath('/settings/request-link');
  revalidatePath('/find-work/requests');
  if (user.publicSlug) revalidatePath(requestPath(user.publicSlug));
  if (data.publicSlug) revalidatePath(requestPath(data.publicSlug));
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

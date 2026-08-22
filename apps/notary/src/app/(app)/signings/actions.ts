'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { requireUser } from '@/lib/auth';
import { prisma } from '@/lib/db';
import { irsMileageRateCents } from '@/lib/compliance';
import { dispatchEvent, type WebhookEvent } from '@/lib/webhooks';
import {
  formDataToObject,
  signingSchema,
  toFieldErrors,
  type FieldErrors,
} from '@/lib/validation';

export type SigningFormState = { errors: FieldErrors } | null;

/** Only link a client the signer actually owns. */
async function resolveClientId(userId: string, clientId: string | null): Promise<string | null> {
  if (!clientId) return null;
  const client = await prisma.client.findFirst({
    where: { id: clientId, userId },
    select: { id: true },
  });
  return client?.id ?? null;
}

export async function createSigningAction(
  _prev: SigningFormState,
  formData: FormData,
): Promise<SigningFormState> {
  const user = await requireUser();

  const parsed = signingSchema.safeParse(formDataToObject(formData));
  if (!parsed.success) return { errors: toFieldErrors(parsed.error) };

  const { clientId, mileageMiles, ...rest } = parsed.data;

  const signing = await prisma.signing.create({
    data: {
      ...rest,
      mileageMiles,
      userId: user.id,
      clientId: await resolveClientId(user.id, clientId),
      completedAt: rest.status === 'COMPLETED' ? new Date() : null,
    },
  });

  if (mileageMiles > 0) {
    await syncMileageEntry(user.id, signing.id, mileageMiles, rest.scheduledAt, rest.title, user.mileageRateCents);
  }

  await dispatchEvent(user.id, eventForStatus(signing.status) ?? 'signing.scheduled', {
    signingId: signing.id,
    title: signing.title,
    status: signing.status,
    scheduledAt: signing.scheduledAt.toISOString(),
    signerName: signing.signerName,
    signerPhone: signing.signerPhone,
    signerEmail: signing.signerEmail,
    city: signing.city,
    state: signing.state,
  });

  revalidatePath('/signings');
  revalidatePath('/dashboard');
  redirect(`/signings/${signing.id}`);
}

export async function updateSigningAction(
  signingId: string,
  _prev: SigningFormState,
  formData: FormData,
): Promise<SigningFormState> {
  const user = await requireUser();

  const parsed = signingSchema.safeParse(formDataToObject(formData));
  if (!parsed.success) return { errors: toFieldErrors(parsed.error) };

  const existing = await prisma.signing.findFirst({
    where: { id: signingId, userId: user.id },
    select: { id: true, status: true, completedAt: true },
  });

  if (!existing) return { errors: { _form: 'That signing no longer exists.' } };

  const { clientId, mileageMiles, ...rest } = parsed.data;
  const nowCompleted = rest.status === 'COMPLETED';

  const signing = await prisma.signing.update({
    where: { id: existing.id },
    data: {
      ...rest,
      mileageMiles,
      clientId: await resolveClientId(user.id, clientId),
      // Preserve the original completion timestamp on re-saves.
      completedAt: nowCompleted ? (existing.completedAt ?? new Date()) : null,
    },
  });

  await syncMileageEntry(
    user.id,
    signing.id,
    mileageMiles,
    signing.scheduledAt,
    signing.title,
    user.mileageRateCents,
  );

  // Fire only on an actual transition, so re-saving a completed signing does
  // not re-trigger a review-request campaign.
  if (existing.status !== signing.status) {
    const event = eventForStatus(signing.status);
    if (event) {
      await dispatchEvent(user.id, event, {
        signingId: signing.id,
        title: signing.title,
        status: signing.status,
        previousStatus: existing.status,
        scheduledAt: signing.scheduledAt.toISOString(),
        completedAt: signing.completedAt?.toISOString() ?? null,
        signerName: signing.signerName,
        signerPhone: signing.signerPhone,
        signerEmail: signing.signerEmail,
        totalFeeCents:
          signing.signingFeeCents +
          signing.travelFeeCents +
          signing.printFeeCents +
          signing.additionalFeeCents,
      });
    }
  }

  revalidatePath('/signings');
  revalidatePath(`/signings/${signingId}`);
  revalidatePath('/dashboard');
  return null;
}

function eventForStatus(status: string): WebhookEvent | null {
  switch (status) {
    case 'COMPLETED':
      return 'signing.completed';
    case 'CANCELLED':
    case 'NO_SHOW':
      return 'signing.cancelled';
    case 'SCHEDULED':
    case 'CONFIRMED':
      return 'signing.scheduled';
    default:
      return null;
  }
}

/**
 * Keep the signing's mileage figure and the deductible mileage log in step.
 *
 * The mileage log is what feeds the tax report, so a mileage number typed on a
 * signing has to reach it. Editing the signing updates the linked entry rather
 * than adding a second one; clearing the mileage removes it.
 */
async function syncMileageEntry(
  userId: string,
  signingId: string,
  miles: number,
  date: Date,
  title: string,
  fallbackRateCents: number,
): Promise<void> {
  const existing = await prisma.mileageEntry.findFirst({
    where: { userId, signingId },
    select: { id: true },
  });

  if (miles <= 0) {
    if (existing) await prisma.mileageEntry.delete({ where: { id: existing.id } });
    return;
  }

  // Value the trip at the IRS rate in force on the day of travel, not today's.
  const rate = Math.round(irsMileageRateCents(date) || fallbackRateCents);

  if (existing) {
    await prisma.mileageEntry.update({
      where: { id: existing.id },
      data: { miles, date, ratePerMileCents: rate, purpose: `Signing — ${title}` },
    });
    return;
  }

  await prisma.mileageEntry.create({
    data: {
      userId,
      signingId,
      miles,
      date,
      ratePerMileCents: rate,
      purpose: `Signing — ${title}`,
    },
  });
}

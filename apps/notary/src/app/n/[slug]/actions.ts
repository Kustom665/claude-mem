'use server';

import { headers } from 'next/headers';
import { redirect } from 'next/navigation';
import { deriveSecret } from '@/lib/auth';
import { prisma } from '@/lib/db';
import { isTakingRequests, loadPublicNotary } from '@/lib/public-notary';
import {
  PUBLIC_REQUEST_SECRET_PURPOSE,
  assessAbuse,
  checkRequestToken,
  clientAddress,
  hashAddress,
  type AbuseVerdict,
} from '@/lib/public-request';
import { parseServicesOffered, requestPath } from '@/lib/request-link';
import {
  formDataToObject,
  publicRequestSchema,
  toFieldErrors,
  type FieldErrors,
} from '@/lib/validation';
import { dispatchEvent } from '@/lib/webhooks';

export type RequestFormState = { errors: FieldErrors } | null;

const HOUR_MS = 60 * 60 * 1000;
const NOT_TAKING = 'This notary is not taking requests right now.';

export async function submitRequestAction(
  slug: string,
  _prev: RequestFormState,
  formData: FormData,
): Promise<RequestFormState> {
  const now = new Date();

  const found = await loadPublicNotary(slug);
  if (!found || !isTakingRequests(found.notary, now)) {
    return { errors: { _form: NOT_TAKING } };
  }
  const { slug: canonical, notary } = found;
  const thanks = `${requestPath(canonical)}/thanks`;

  const secret = deriveSecret(PUBLIC_REQUEST_SECRET_PURPOSE);
  const honeypot = String(formData.get('website') ?? '');
  const token = checkRequestToken(
    String(formData.get('token') ?? ''),
    canonical,
    secret,
    now.getTime(),
  );

  const reject = (verdict: Extract<AbuseVerdict, { allow: false }>): RequestFormState => {
    // A bot that filled the hidden field is told it worked, so it learns nothing.
    if (verdict.silent) redirect(thanks);
    return { errors: { _form: verdict.message } };
  };

  // The checks that cost nothing come first, so a flood is turned away before it
  // reaches the database.
  const early = assessAbuse({
    honeypot,
    token,
    recentFromAddressLastHour: 0,
    recentFromAddressLastDay: 0,
    recentForNotaryLastHour: 0,
  });
  if (!early.allow) return reject(early);

  // The public form's dates are the requester's, not the notary's, so no time
  // zone is passed: "2026-10-20" stays the calendar day they chose.
  const parsed = publicRequestSchema.safeParse(formDataToObject(formData));
  if (!parsed.success) return { errors: toFieldErrors(parsed.error) };
  const input = parsed.data;

  if (!parseServicesOffered(notary.servicesOffered).includes(input.service)) {
    return { errors: { service: 'This notary does not offer that service.' } };
  }

  const addressHash = hashAddress(clientAddress(await headers()), secret);
  const hourAgo = new Date(now.getTime() - HOUR_MS);
  const dayAgo = new Date(now.getTime() - 24 * HOUR_MS);

  const [fromAddressHour, fromAddressDay, forNotaryHour] = await Promise.all([
    addressHash
      ? prisma.workRequest.count({ where: { ipHash: addressHash, createdAt: { gte: hourAgo } } })
      : 0,
    addressHash
      ? prisma.workRequest.count({ where: { ipHash: addressHash, createdAt: { gte: dayAgo } } })
      : 0,
    prisma.workRequest.count({ where: { userId: notary.id, createdAt: { gte: hourAgo } } }),
  ]);

  const verdict = assessAbuse({
    honeypot,
    token,
    recentFromAddressLastHour: fromAddressHour,
    recentFromAddressLastDay: fromAddressDay,
    recentForNotaryLastHour: forNotaryHour,
  });
  if (!verdict.allow) return reject(verdict);

  const created = await prisma.workRequest.create({
    data: {
      userId: notary.id,
      requesterName: input.requesterName,
      requesterPhone: input.requesterPhone,
      requesterEmail: input.requesterEmail,
      preferredContact: input.preferredContact,
      service: input.service,
      documentSummary: input.documentSummary,
      signerCount: input.signerCount,
      preferredDate: input.preferredDate,
      preferredWindow: input.preferredWindow,
      addressLine1: input.addressLine1,
      city: input.city,
      state: input.state,
      postalCode: input.postalCode,
      message: input.message,
      ipHash: addressHash,
    },
    select: { id: true },
  });

  // To the notary's own automation platform, so a lead can be answered in minutes.
  await dispatchEvent(notary.id, 'request.created', {
    requestId: created.id,
    requesterName: input.requesterName,
    requesterPhone: input.requesterPhone,
    requesterEmail: input.requesterEmail,
    preferredContact: input.preferredContact,
    service: input.service,
    signerCount: input.signerCount,
    preferredDate: input.preferredDate ? input.preferredDate.toISOString().slice(0, 10) : null,
    preferredWindow: input.preferredWindow,
    city: input.city,
    state: input.state,
    postalCode: input.postalCode,
    documentSummary: input.documentSummary,
    message: input.message,
  });

  redirect(thanks);
}

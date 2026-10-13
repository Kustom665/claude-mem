import 'server-only';

import { cache } from 'react';
import { prisma } from './db';
import { checkCanPublish, checkSlug } from './request-link';

/**
 * Loading a notary for the public request page.
 *
 * This is the one place an unauthenticated visitor's request reaches the
 * `User` table, so the select below is an allow-list: a column is public only
 * because it is named here. Email, password hash, address, commission number,
 * insurance details, the webhook secret and everything else never leave the
 * database for these pages — adding a field to `User` cannot expose it.
 */
const loadPublic = cache(async (slug: string) =>
  prisma.user.findUnique({
    where: { publicSlug: slug },
    select: {
      id: true,
      name: true,
      businessName: true,
      phone: true,
      timezone: true,
      commissionState: true,
      commissionCounty: true,
      commissionExpiresOn: true,
      isSigningAgent: true,
      acceptingRequests: true,
      publicHeadline: true,
      publicBio: true,
      serviceArea: true,
      servicesOffered: true,
      requestMinNoticeHours: true,
      showFeesPublicly: true,
      showPhonePublicly: true,
      feeScheduleItems: {
        where: { isActive: true },
        orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
        // Not `notes`: those are the notary's own bookkeeping ("exempt from
        // self-employment tax"), written for them and meaningless to a customer.
        select: { id: true, name: true, amountCents: true, unit: true },
      },
    },
  }),
);

export type PublicNotary = NonNullable<Awaited<ReturnType<typeof loadPublic>>>;

/**
 * The notary behind `/n/{slug}`, or null when the address matches nobody.
 * `slug` is the canonical form, which can differ in case from what was typed.
 */
export async function loadPublicNotary(
  rawSlug: string,
): Promise<{ slug: string; notary: PublicNotary } | null> {
  const checked = checkSlug(rawSlug);
  if (!checked.ok) return null;

  const notary = await loadPublic(checked.slug);
  return notary ? { slug: checked.slug, notary } : null;
}

/** Whether the page should be taking requests right now. */
export function isTakingRequests(notary: PublicNotary, now: Date = new Date()): boolean {
  return notary.acceptingRequests && checkCanPublish(notary, now).ok;
}

/** What to call the notary: the business name if there is one. */
export function displayNameFor(notary: Pick<PublicNotary, 'name' | 'businessName'>): string {
  return notary.businessName?.trim() || notary.name;
}

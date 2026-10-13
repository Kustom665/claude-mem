import { endOfDayInZone } from './dates';
import { REQUEST_SERVICES, type RequestService } from './domain';

/**
 * The public request link: /n/{slug}.
 *
 * A slug is the one part of a notary's record that is deliberately public, so
 * it is held to a narrow, boring shape — lowercase letters, digits and single
 * hyphens — that cannot be confused with a path, an entity or an email.
 */

export const SLUG_MIN_LENGTH = 3;
export const SLUG_MAX_LENGTH = 40;

/**
 * Words a notary cannot take as a slug. The route is /n/{slug}, so none of these
 * could collide with an app path today; they are reserved so that a future
 * vanity-domain or root-level route does not turn them into someone's
 * impersonation of this product.
 */
export const RESERVED_SLUGS: ReadonlySet<string> = new Set([
  'admin',
  'api',
  'app',
  'billing',
  'dashboard',
  'help',
  'login',
  'new',
  'notary',
  'notarydesk',
  'notary-desk',
  'settings',
  'sign-in',
  'sign-up',
  'support',
  'thanks',
  'www',
]);

/** Turn anything a person might type into a slug candidate. */
export function normalizeSlug(input: string): string {
  const cleaned = input
    .toLowerCase()
    // Fold accents so "Café" becomes "cafe", not "caf".
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');

  return cleaned.slice(0, SLUG_MAX_LENGTH).replace(/-+$/g, '');
}

const SLUG_PATTERN = /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/;

export type SlugCheck = { ok: true; slug: string } | { ok: false; message: string };

export function checkSlug(input: string): SlugCheck {
  const slug = normalizeSlug(input);

  if (slug.length < SLUG_MIN_LENGTH) {
    return {
      ok: false,
      message: `Use at least ${SLUG_MIN_LENGTH} letters or numbers.`,
    };
  }
  if (!SLUG_PATTERN.test(slug) || slug.includes('--')) {
    return { ok: false, message: 'Use only letters, numbers and single hyphens.' };
  }
  if (RESERVED_SLUGS.has(slug)) {
    return { ok: false, message: 'That address is reserved. Try adding your name or city.' };
  }
  return { ok: true, slug };
}

/** A starting suggestion drawn from whatever the notary has already entered. */
export function suggestSlug(parts: {
  businessName?: string | null;
  name?: string | null;
  city?: string | null;
}): string {
  const direct = checkSlug(parts.businessName || parts.name || '');
  if (direct.ok) return direct.slug;

  // The business name was unusable (reserved, or too short). Build one from the
  // person instead — but only if there is a person to build it from, otherwise
  // the suggestion would be the bare word "notary", which is itself reserved.
  const personal = normalizeSlug(`${parts.name ?? ''} ${parts.city ?? ''}`);
  if (!personal) return '';

  const fallback = checkSlug(`${personal} notary`);
  return fallback.ok ? fallback.slug : '';
}

/** The path a requester visits. Absolute URLs are built where the host is known. */
export function requestPath(slug: string): string {
  return `/n/${slug}`;
}

/**
 * Scheme and host the notary is using right now, so Settings can show the whole
 * link ready to copy. Taken from the proxy headers; the value is only ever shown
 * back to the person who sent them, so a forged header can mislead nobody else.
 */
export function originFromHeaders(
  headers: { get(name: string): string | null },
  fallback = 'http://localhost:3000',
): string {
  const host = (headers.get('x-forwarded-host') ?? headers.get('host') ?? '')
    .split(',')[0]
    ?.trim();
  if (!host || !/^[a-z0-9.-]+(?::\d{1,5})?$/i.test(host)) return fallback;

  const forwardedProto = headers.get('x-forwarded-proto')?.split(',')[0]?.trim().toLowerCase();
  if (forwardedProto === 'http' || forwardedProto === 'https') return `${forwardedProto}://${host}`;

  const isLocal = /^(localhost|127\.|\[::1\])/.test(host);
  return `${isLocal ? 'http' : 'https'}://${host}`;
}

export type PublishCheck = { ok: true } | { ok: false; reason: string };

/**
 * Whether this notary may have a public page at all.
 *
 * A public "hire me" page for a notary whose commission has lapsed would invite
 * people to book acts that would be void, so the link is only live while the
 * commission is on file and in date. The same check runs when the notary tries
 * to switch the link on and every time the public page is served.
 */
export function checkCanPublish(
  user: {
    commissionState: string | null;
    commissionExpiresOn: Date | null;
    timezone: string;
  },
  now: Date = new Date(),
): PublishCheck {
  if (!user.commissionState) {
    return {
      ok: false,
      reason: 'Add your commission state under Settings → Commission & compliance first.',
    };
  }
  if (!user.commissionExpiresOn) {
    return {
      ok: false,
      reason: 'Add your commission expiry date under Settings → Commission & compliance first.',
    };
  }
  if (endOfDayInZone(user.commissionExpiresOn, user.timezone).getTime() < now.getTime()) {
    return {
      ok: false,
      reason:
        'Your commission has expired, so the link cannot take requests. Renew it, then update ' +
        'the date under Settings → Commission & compliance.',
    };
  }
  return { ok: true };
}

export function isRequestService(value: string): value is RequestService {
  return (REQUEST_SERVICES as readonly string[]).includes(value);
}

/** Services a notary offers, as stored: a comma-separated list. */
export function parseServicesOffered(stored: string | null | undefined): RequestService[] {
  const wanted = new Set((stored ?? '').split(',').map((part) => part.trim()));
  // Re-emit in the canonical order so the page and the settings form agree.
  return REQUEST_SERVICES.filter((service) => wanted.has(service));
}

export function serializeServicesOffered(values: Iterable<string>): string {
  const wanted = new Set(values);
  return REQUEST_SERVICES.filter((service) => wanted.has(service)).join(',');
}

import { createHmac, timingSafeEqual } from 'node:crypto';
import { isIP } from 'node:net';

/**
 * Abuse protection for the one unauthenticated write in the app.
 *
 * Everything else here sits behind a session. The public request form cannot,
 * so it gets three cheap, layered defenses — none of which is a vault, all of
 * which together make automated spam expensive enough to look elsewhere:
 *
 *   1. a hidden field a person never sees and a script fills in
 *   2. a signed timestamp, so a form that "submitted" faster than a person can
 *      read it, or that is days old, or that never came from this page, is out
 *   3. per-address and per-notary rate limits, counted in the database
 *
 * The requester's address is hashed with a server secret before it is stored.
 * It exists to count repeats, not to identify anyone.
 */

export const REQUEST_LIMITS = {
  /** A person cannot read a form, fill it and submit it faster than this. */
  minFillMs: 2_500,
  /** Beyond this the page was left open, so ask for a reload. */
  maxAgeMs: 2 * 60 * 60 * 1000,
  perAddressPerHour: 3,
  perAddressPerDay: 8,
  /** Stops a distributed flood from burying one notary's inbox. */
  perNotaryPerHour: 25,
} as const;

/**
 * The purpose string for the key (derived from SESSION_SECRET) that signs form
 * tokens and hashes addresses. Fixed, so a token issued by one instance of the
 * app is accepted by another.
 */
export const PUBLIC_REQUEST_SECRET_PURPOSE = 'public-request';

/** Clock skew tolerated when a token appears to come from the future. */
const FUTURE_TOLERANCE_MS = 5_000;

function sign(secret: string, slug: string, issuedAt: string): string {
  return createHmac('sha256', secret).update(`request:${slug}:${issuedAt}`).digest('hex');
}

/** A token to embed in the form when the page is rendered. */
export function issueRequestToken(slug: string, secret: string, now: number = Date.now()): string {
  const issuedAt = String(now);
  return `${issuedAt}.${sign(secret, slug, issuedAt)}`;
}

export type TokenCheck =
  | { ok: true; ageMs: number }
  | { ok: false; reason: 'MALFORMED' | 'BAD_SIGNATURE' | 'FUTURE' | 'EXPIRED' };

export function checkRequestToken(
  token: string | null | undefined,
  slug: string,
  secret: string,
  now: number = Date.now(),
): TokenCheck {
  const parts = (token ?? '').split('.');
  if (parts.length !== 2 || !/^\d{10,16}$/.test(parts[0]) || !/^[0-9a-f]{64}$/.test(parts[1])) {
    return { ok: false, reason: 'MALFORMED' };
  }

  const [issuedAt, signature] = parts;
  const expected = sign(secret, slug, issuedAt);
  if (!timingSafeEqual(Buffer.from(signature, 'hex'), Buffer.from(expected, 'hex'))) {
    return { ok: false, reason: 'BAD_SIGNATURE' };
  }

  const ageMs = now - Number(issuedAt);
  if (ageMs < -FUTURE_TOLERANCE_MS) return { ok: false, reason: 'FUTURE' };
  if (ageMs > REQUEST_LIMITS.maxAgeMs) return { ok: false, reason: 'EXPIRED' };
  return { ok: true, ageMs: Math.max(0, ageMs) };
}

/** The requester's address as reported by the proxy in front of the app. */
export function clientAddress(headers: { get(name: string): string | null }): string | null {
  // On Vercel the platform sets x-forwarded-for, and its first entry is the
  // client. Elsewhere the header can be spoofed — which only lets an attacker
  // dodge a per-address counter, never reach anything private.
  const forwarded = headers.get('x-forwarded-for')?.split(',')[0]?.trim();
  const candidate = forwarded || headers.get('x-real-ip')?.trim() || '';
  return isIP(candidate) ? candidate : null;
}

/** One-way, keyed digest of an address; null when none could be determined. */
export function hashAddress(address: string | null, secret: string): string | null {
  if (!address) return null;
  return createHmac('sha256', secret).update(`address:${address}`).digest('hex').slice(0, 32);
}

export type AbuseInput = {
  /** Whatever the hidden field contained. */
  honeypot: string;
  token: TokenCheck;
  recentFromAddressLastHour: number;
  recentFromAddressLastDay: number;
  recentForNotaryLastHour: number;
};

export type AbuseVerdict =
  | { allow: true }
  | {
      allow: false;
      reason:
        | 'HONEYPOT'
        | 'TOKEN_INVALID'
        | 'TOKEN_EXPIRED'
        | 'TOO_FAST'
        | 'ADDRESS_LIMIT'
        | 'NOTARY_LIMIT';
      /** Pretend it worked, so a bot learns nothing from the response. */
      silent: boolean;
      message: string;
    };

export function assessAbuse(input: AbuseInput): AbuseVerdict {
  if (input.honeypot.trim() !== '') {
    return {
      allow: false,
      reason: 'HONEYPOT',
      silent: true,
      message: 'Request not stored.',
    };
  }

  if (!input.token.ok) {
    const expired = input.token.reason === 'EXPIRED';
    return {
      allow: false,
      reason: expired ? 'TOKEN_EXPIRED' : 'TOKEN_INVALID',
      silent: false,
      message: expired
        ? 'This form has been open a while. Reload the page and send it again.'
        : 'We could not verify this form. Reload the page and try again.',
    };
  }

  if (input.token.ageMs < REQUEST_LIMITS.minFillMs) {
    return {
      allow: false,
      reason: 'TOO_FAST',
      silent: false,
      message: 'That was quick. Check your details, then send the request again.',
    };
  }

  if (
    input.recentFromAddressLastHour >= REQUEST_LIMITS.perAddressPerHour ||
    input.recentFromAddressLastDay >= REQUEST_LIMITS.perAddressPerDay
  ) {
    return {
      allow: false,
      reason: 'ADDRESS_LIMIT',
      silent: false,
      message: 'You have sent several requests already. Please wait, or call the notary directly.',
    };
  }

  if (input.recentForNotaryLastHour >= REQUEST_LIMITS.perNotaryPerHour) {
    return {
      allow: false,
      reason: 'NOTARY_LIMIT',
      silent: false,
      message: 'This notary is receiving a lot of requests right now. Please try again later.',
    };
  }

  return { allow: true };
}

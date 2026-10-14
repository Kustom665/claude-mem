import { describe, expect, it } from 'vitest';
import {
  assessAbuse,
  checkRequestToken,
  clientAddress,
  hashAddress,
  issueRequestToken,
  REQUEST_LIMITS,
  type AbuseInput,
} from '@/lib/public-request';
import {
  checkSlug,
  normalizeSlug,
  parseServicesOffered,
  serializeServicesOffered,
  SLUG_MAX_LENGTH,
  suggestSlug,
} from '@/lib/request-link';
import { proposedStart, requestNote } from '@/lib/requests';
import { zonedTimeToUtc } from '@/lib/dates';

const SECRET = 'test-secret-that-is-long-enough-for-hmac';
const NOW = 1_790_000_000_000;

describe('slugs', () => {
  it('turns a business name into a url-safe slug', () => {
    expect(normalizeSlug('Keystone Mobile Notary')).toBe('keystone-mobile-notary');
    expect(normalizeSlug('  Dana  &  Co.  ')).toBe('dana-and-co');
  });

  it('folds accents instead of dropping the letter', () => {
    expect(normalizeSlug('Café Notaire')).toBe('cafe-notaire');
  });

  it('collapses punctuation runs and trims hyphens', () => {
    expect(normalizeSlug('---a___b!!!c---')).toBe('a-b-c');
  });

  it('caps the length without leaving a trailing hyphen', () => {
    const long = normalizeSlug('a'.repeat(SLUG_MAX_LENGTH - 1) + ' bbbbbb');
    expect(long.length).toBeLessThanOrEqual(SLUG_MAX_LENGTH);
    expect(long.endsWith('-')).toBe(false);
  });

  it('rejects slugs that are too short, empty or reserved', () => {
    expect(checkSlug('ab').ok).toBe(false);
    expect(checkSlug('!!!').ok).toBe(false);
    expect(checkSlug('Admin').ok).toBe(false);
    expect(checkSlug('sign-in').ok).toBe(false);
  });

  it('accepts and normalises a good slug', () => {
    expect(checkSlug('Dana Whitfield Notary')).toEqual({ ok: true, slug: 'dana-whitfield-notary' });
  });

  it('suggests from the business name, then falls back to name and city', () => {
    expect(suggestSlug({ businessName: 'Keystone Mobile Notary', name: 'Dana', city: 'Pittsburgh' })).toBe(
      'keystone-mobile-notary',
    );
    expect(suggestSlug({ businessName: null, name: 'Dana Whitfield', city: 'Pittsburgh' })).toBe(
      'dana-whitfield',
    );
    // A business name that cannot be used (reserved, or too short) falls back to
    // the notary's name and city rather than offering something that will fail.
    expect(suggestSlug({ businessName: 'Admin', name: 'Dana Whitfield', city: 'Erie' })).toBe(
      'dana-whitfield-erie-notary',
    );
    expect(suggestSlug({ name: 'Al', city: 'Erie' })).toBe('al-erie-notary');
    expect(suggestSlug({})).toBe('');
  });
});

describe('services offered', () => {
  it('stores in canonical order and drops anything unknown', () => {
    expect(serializeServicesOffered(['ESTATE_PLANNING', 'bogus', 'GENERAL', 'GENERAL'])).toBe(
      'GENERAL,ESTATE_PLANNING',
    );
  });

  it('parses a stored list back, tolerating blanks', () => {
    expect(parseServicesOffered('GENERAL, LOAN_SIGNING ,')).toEqual(['GENERAL', 'LOAN_SIGNING']);
    expect(parseServicesOffered('')).toEqual([]);
    expect(parseServicesOffered(null)).toEqual([]);
  });
});

describe('request tokens', () => {
  it('accepts a fresh token and reports its age', () => {
    const token = issueRequestToken('dana', SECRET, NOW);
    expect(checkRequestToken(token, 'dana', SECRET, NOW + 6_000)).toEqual({ ok: true, ageMs: 6_000 });
  });

  it('rejects a token issued for a different notary', () => {
    const token = issueRequestToken('dana', SECRET, NOW);
    expect(checkRequestToken(token, 'someone-else', SECRET, NOW + 6_000)).toEqual({
      ok: false,
      reason: 'BAD_SIGNATURE',
    });
  });

  it('rejects a token signed with a different secret', () => {
    const token = issueRequestToken('dana', 'another-secret-entirely-xxxxxxxx', NOW);
    expect(checkRequestToken(token, 'dana', SECRET, NOW + 6_000).ok).toBe(false);
  });

  it('rejects a tampered timestamp', () => {
    const token = issueRequestToken('dana', SECRET, NOW);
    const [, signature] = token.split('.');
    const forged = `${NOW - 3_600_000}.${signature}`;
    expect(checkRequestToken(forged, 'dana', SECRET, NOW + 6_000)).toEqual({
      ok: false,
      reason: 'BAD_SIGNATURE',
    });
  });

  it('expires after the documented lifetime', () => {
    const token = issueRequestToken('dana', SECRET, NOW);
    expect(checkRequestToken(token, 'dana', SECRET, NOW + REQUEST_LIMITS.maxAgeMs + 1)).toEqual({
      ok: false,
      reason: 'EXPIRED',
    });
  });

  it('rejects a token from the future', () => {
    const token = issueRequestToken('dana', SECRET, NOW + 60_000);
    expect(checkRequestToken(token, 'dana', SECRET, NOW)).toEqual({ ok: false, reason: 'FUTURE' });
  });

  it('rejects garbage without throwing', () => {
    for (const bad of [null, undefined, '', 'nope', '1.2.3', `${NOW}.zzzz`, '.']) {
      expect(checkRequestToken(bad, 'dana', SECRET, NOW)).toEqual({ ok: false, reason: 'MALFORMED' });
    }
  });
});

describe('client address', () => {
  const headers = (values: Record<string, string>) => ({
    get: (name: string) => values[name.toLowerCase()] ?? null,
  });

  it('takes the first entry of x-forwarded-for', () => {
    expect(clientAddress(headers({ 'x-forwarded-for': '203.0.113.9, 10.0.0.1' }))).toBe('203.0.113.9');
  });

  it('falls back to x-real-ip', () => {
    expect(clientAddress(headers({ 'x-real-ip': '198.51.100.4' }))).toBe('198.51.100.4');
  });

  it('accepts IPv6', () => {
    expect(clientAddress(headers({ 'x-forwarded-for': '2001:db8::1' }))).toBe('2001:db8::1');
  });

  it('refuses anything that is not an address', () => {
    expect(clientAddress(headers({ 'x-forwarded-for': 'not an ip' }))).toBeNull();
    expect(clientAddress(headers({}))).toBeNull();
  });
});

describe('address hashing', () => {
  it('is deterministic and keyed', () => {
    expect(hashAddress('203.0.113.9', SECRET)).toBe(hashAddress('203.0.113.9', SECRET));
    expect(hashAddress('203.0.113.9', SECRET)).not.toBe(hashAddress('203.0.113.10', SECRET));
    expect(hashAddress('203.0.113.9', SECRET)).not.toBe(hashAddress('203.0.113.9', 'other-secret-xxxxxxxxxxxxxxxx'));
  });

  it('never contains the address itself', () => {
    expect(hashAddress('203.0.113.9', SECRET)).not.toContain('203');
  });

  it('is null when there is no address to hash', () => {
    expect(hashAddress(null, SECRET)).toBeNull();
  });
});

describe('assessAbuse', () => {
  const ok: AbuseInput = {
    honeypot: '',
    token: { ok: true, ageMs: 20_000 },
    recentFromAddressLastHour: 0,
    recentFromAddressLastDay: 0,
    recentForNotaryLastHour: 0,
  };

  it('lets an ordinary request through', () => {
    expect(assessAbuse(ok)).toEqual({ allow: true });
  });

  it('drops a filled honeypot silently so a bot learns nothing', () => {
    const verdict = assessAbuse({ ...ok, honeypot: 'http://spam.example' });
    expect(verdict).toMatchObject({ allow: false, reason: 'HONEYPOT', silent: true });
  });

  it('checks the honeypot before anything else', () => {
    const verdict = assessAbuse({
      ...ok,
      honeypot: 'x',
      token: { ok: false, reason: 'MALFORMED' },
    });
    expect(verdict).toMatchObject({ reason: 'HONEYPOT' });
  });

  it('asks a real person with a stale form to reload', () => {
    const verdict = assessAbuse({ ...ok, token: { ok: false, reason: 'EXPIRED' } });
    expect(verdict).toMatchObject({ allow: false, reason: 'TOKEN_EXPIRED', silent: false });
    expect(verdict.allow === false && verdict.message).toContain('Reload');
  });

  it('refuses an unverifiable token', () => {
    expect(assessAbuse({ ...ok, token: { ok: false, reason: 'BAD_SIGNATURE' } })).toMatchObject({
      reason: 'TOKEN_INVALID',
    });
  });

  it('refuses a form submitted faster than a person can fill it', () => {
    const verdict = assessAbuse({ ...ok, token: { ok: true, ageMs: REQUEST_LIMITS.minFillMs - 1 } });
    expect(verdict).toMatchObject({ allow: false, reason: 'TOO_FAST', silent: false });
  });

  it('allows a submission exactly at the minimum fill time', () => {
    expect(assessAbuse({ ...ok, token: { ok: true, ageMs: REQUEST_LIMITS.minFillMs } })).toEqual({
      allow: true,
    });
  });

  it('limits repeats from one address by the hour and by the day', () => {
    expect(
      assessAbuse({ ...ok, recentFromAddressLastHour: REQUEST_LIMITS.perAddressPerHour }),
    ).toMatchObject({ reason: 'ADDRESS_LIMIT' });
    expect(
      assessAbuse({ ...ok, recentFromAddressLastDay: REQUEST_LIMITS.perAddressPerDay }),
    ).toMatchObject({ reason: 'ADDRESS_LIMIT' });
    expect(
      assessAbuse({ ...ok, recentFromAddressLastHour: REQUEST_LIMITS.perAddressPerHour - 1 }),
    ).toEqual({ allow: true });
  });

  it('caps what one notary receives in an hour', () => {
    expect(
      assessAbuse({ ...ok, recentForNotaryLastHour: REQUEST_LIMITS.perNotaryPerHour }),
    ).toMatchObject({ reason: 'NOTARY_LIMIT' });
  });
});

describe('zonedTimeToUtc', () => {
  it('converts a New York summer time (EDT, UTC-4)', () => {
    expect(zonedTimeToUtc(2026, 10, 20, 10, 0, 'America/New_York').toISOString()).toBe(
      '2026-10-20T14:00:00.000Z',
    );
  });

  it('converts a New York winter time (EST, UTC-5)', () => {
    expect(zonedTimeToUtc(2026, 12, 1, 10, 0, 'America/New_York').toISOString()).toBe(
      '2026-12-01T15:00:00.000Z',
    );
  });

  it('converts Pacific and European zones', () => {
    expect(zonedTimeToUtc(2026, 7, 4, 9, 0, 'America/Los_Angeles').toISOString()).toBe(
      '2026-07-04T16:00:00.000Z',
    );
    expect(zonedTimeToUtc(2026, 7, 1, 12, 0, 'Europe/Berlin').toISOString()).toBe(
      '2026-07-01T10:00:00.000Z',
    );
  });

  it('gets the day of a daylight-saving change right on both sides of the jump', () => {
    // US clocks spring forward at 02:00 on 8 March 2026.
    expect(zonedTimeToUtc(2026, 3, 8, 1, 0, 'America/New_York').toISOString()).toBe(
      '2026-03-08T06:00:00.000Z',
    );
    expect(zonedTimeToUtc(2026, 3, 8, 10, 0, 'America/New_York').toISOString()).toBe(
      '2026-03-08T14:00:00.000Z',
    );
    // ...and fall back at 02:00 on 1 November 2026.
    expect(zonedTimeToUtc(2026, 11, 1, 10, 0, 'America/New_York').toISOString()).toBe(
      '2026-11-01T15:00:00.000Z',
    );
  });

  it('is independent of the zone the test runner is in', () => {
    // Sealing and verifying must not depend on TZ; neither should scheduling.
    expect(zonedTimeToUtc(2026, 1, 15, 0, 0, 'UTC').toISOString()).toBe('2026-01-15T00:00:00.000Z');
  });
});

describe('proposedStart', () => {
  const NOW_DATE = new Date('2026-10-13T15:20:00Z');

  it('uses the requested day and window in the notary zone', () => {
    const start = proposedStart(
      { preferredDate: new Date('2026-10-20T00:00:00Z'), preferredWindow: 'AFTERNOON' },
      'America/New_York',
      24,
      NOW_DATE,
    );
    // 13:00 EDT
    expect(start.toISOString()).toBe('2026-10-20T17:00:00.000Z');
  });

  it('falls back to the earliest allowed slot when no date was given', () => {
    const start = proposedStart({ preferredDate: null, preferredWindow: 'FLEXIBLE' }, 'America/New_York', 24, NOW_DATE);
    // 24h notice from 15:20Z, rounded up to the next whole hour.
    expect(start.toISOString()).toBe('2026-10-14T16:00:00.000Z');
  });

  it('never proposes a time in the past', () => {
    const start = proposedStart(
      { preferredDate: new Date('2026-10-01T00:00:00Z'), preferredWindow: 'MORNING' },
      'America/New_York',
      2,
      NOW_DATE,
    );
    expect(start.getTime()).toBeGreaterThan(NOW_DATE.getTime());
    expect(start.toISOString()).toBe('2026-10-13T18:00:00.000Z');
  });

  it('treats an unrecognized window as flexible', () => {
    const start = proposedStart(
      { preferredDate: new Date('2026-10-20T00:00:00Z'), preferredWindow: 'nonsense' },
      'America/New_York',
      24,
      NOW_DATE,
    );
    // 10:00 EDT
    expect(start.toISOString()).toBe('2026-10-20T14:00:00.000Z');
  });
});

describe('requestNote', () => {
  it('carries everything the requester said onto the signing', () => {
    const note = requestNote({
      service: 'ESTATE_PLANNING',
      documentSummary: 'Power of attorney for my mother',
      signerCount: 2,
      preferredContact: 'TEXT',
      preferredWindow: 'MORNING',
      message: 'She uses a wheelchair; ground floor please.',
      requesterPhone: '(412) 555-0199',
      requesterEmail: null,
    });
    expect(note).toContain('Wills, powers of attorney, healthcare directives');
    expect(note).toContain('Power of attorney for my mother');
    expect(note).toContain('Signers: 2');
    expect(note).toContain('Text message');
    expect(note).toContain('wheelchair');
  });

  it('omits what was not provided', () => {
    const note = requestNote({
      service: 'GENERAL',
      documentSummary: null,
      signerCount: 1,
      preferredContact: 'ANY',
      preferredWindow: 'FLEXIBLE',
      message: null,
      requesterPhone: null,
      requesterEmail: null,
    });
    expect(note).not.toContain('Documents:');
    expect(note).not.toContain('Message:');
  });
});

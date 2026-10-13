import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  advertisingNoticesFor,
  commissionVerificationUrlFor,
  NON_ATTORNEY_NOTICE,
  PA_ADVERTISING_NOTICE,
  PA_NOTARY_SEARCH_URL,
} from '@/lib/compliance';
import { interpretWallClock } from '@/lib/dates';
import { checkCanPublish, originFromHeaders } from '@/lib/request-link';
import { mailtoHref, smsHref, telHref, waitingLabel } from '@/lib/requests';

describe('telHref and smsHref', () => {
  it('dials a US number however it was punctuated', () => {
    expect(telHref('(412) 555-0199')).toBe('tel:+14125550199');
    expect(telHref('412.555.0199')).toBe('tel:+14125550199');
    expect(smsHref('412 555 0199')).toBe('sms:+14125550199');
  });

  it('keeps a country code that was typed', () => {
    expect(telHref('+1 412 555 0199')).toBe('tel:+14125550199');
    expect(telHref('1-412-555-0199')).toBe('tel:+14125550199');
    expect(telHref('+44 20 7946 0958')).toBe('tel:+442079460958');
  });

  it('refuses what is not a dialable number', () => {
    expect(telHref('555-0199')).toBeNull();
    expect(telHref('call me later')).toBeNull();
    expect(telHref('1234567890123456')).toBeNull();
    expect(telHref(null)).toBeNull();
    expect(smsHref(undefined)).toBeNull();
  });
});

describe('mailtoHref', () => {
  it('links an ordinary address', () => {
    expect(mailtoHref('dana@example.com')).toBe('mailto:dana@example.com');
    expect(mailtoHref("o'brien+jobs@mail.example.co.uk")).toBe(
      "mailto:o'brien+jobs@mail.example.co.uk",
    );
  });

  it('will not turn a stranger’s text into extra recipients or headers', () => {
    expect(mailtoHref('a@example.com?cc=victim@example.org')).toBeNull();
    expect(mailtoHref('a@example.com,b@example.org')).toBeNull();
    expect(mailtoHref('a@example.com&bcc=x@example.org')).toBeNull();
    expect(mailtoHref('not an address')).toBeNull();
    expect(mailtoHref('')).toBeNull();
    expect(mailtoHref(null)).toBeNull();
  });
});

describe('waitingLabel', () => {
  const now = new Date('2026-10-13T12:00:00Z');

  it('says how long a request has waited', () => {
    expect(waitingLabel(new Date('2026-10-13T11:59:30Z'), now)).toBe('just now');
    expect(waitingLabel(new Date('2026-10-13T11:30:00Z'), now)).toBe('30 min ago');
    expect(waitingLabel(new Date('2026-10-13T09:00:00Z'), now)).toBe('3 h ago');
    expect(waitingLabel(new Date('2026-10-10T12:00:00Z'), now)).toBe('3 d ago');
  });

  it('does not go negative when clocks disagree', () => {
    expect(waitingLabel(new Date('2026-10-13T12:05:00Z'), now)).toBe('just now');
  });
});

describe('originFromHeaders', () => {
  const headers = (init: Record<string, string>) => ({
    get: (name: string) => init[name.toLowerCase()] ?? null,
  });

  it('builds the link a notary can paste from the host they are using', () => {
    expect(
      originFromHeaders(headers({ host: 'notary-desk-pa.vercel.app', 'x-forwarded-proto': 'https' })),
    ).toBe('https://notary-desk-pa.vercel.app');
    expect(originFromHeaders(headers({ host: 'example.com' }))).toBe('https://example.com');
  });

  it('uses http for a machine on the notary’s own desk', () => {
    expect(originFromHeaders(headers({ host: 'localhost:3000' }))).toBe('http://localhost:3000');
    expect(originFromHeaders(headers({ host: '127.0.0.1:3100' }))).toBe('http://127.0.0.1:3100');
  });

  it('prefers the forwarded host and takes the first of a list', () => {
    expect(
      originFromHeaders(headers({ 'x-forwarded-host': 'a.example.com, b.example.com', host: 'internal' })),
    ).toBe('https://a.example.com');
  });

  it('falls back rather than echoing a hostile header', () => {
    expect(originFromHeaders(headers({ host: 'bad host!<script>' }))).toBe('http://localhost:3000');
    expect(originFromHeaders(headers({}))).toBe('http://localhost:3000');
  });
});

describe('checkCanPublish', () => {
  const ZONE = 'America/New_York';
  const expiring = (isoDate: string) => interpretWallClock(isoDate, ZONE);
  const notary = (overrides: Partial<Parameters<typeof checkCanPublish>[0]> = {}) => ({
    commissionState: 'PA',
    commissionExpiresOn: expiring('2027-03-01'),
    timezone: ZONE,
    ...overrides,
  });
  const NOW = new Date('2026-10-13T12:00:00Z');

  it('lets a notary with a commission in date publish', () => {
    expect(checkCanPublish(notary(), NOW)).toEqual({ ok: true });
  });

  it('needs a commission state and an expiry date on file', () => {
    expect(checkCanPublish(notary({ commissionState: null }), NOW).ok).toBe(false);
    expect(checkCanPublish(notary({ commissionExpiresOn: null }), NOW).ok).toBe(false);
  });

  it('takes the page down once the commission has expired', () => {
    const result = checkCanPublish(notary({ commissionExpiresOn: expiring('2026-10-12') }), NOW);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toMatch(/expired/i);
  });

  it('keeps the page up for the whole of the expiry day, on the notary’s clock', () => {
    const lastDay = notary({ commissionExpiresOn: expiring('2026-10-13') });
    // 21:00 on 13 October in New York is already 14 October in UTC.
    expect(checkCanPublish(lastDay, new Date('2026-10-14T01:00:00Z')).ok).toBe(true);
    // 00:05 the next morning in New York is past it.
    expect(checkCanPublish(lastDay, new Date('2026-10-14T04:05:00Z')).ok).toBe(false);
  });
});

describe('advertising notices', () => {
  it('adds Pennsylvania’s non-attorney statement first for a Pennsylvania notary', () => {
    const notices = advertisingNoticesFor('PA');
    expect(notices).toEqual([PA_ADVERTISING_NOTICE, NON_ATTORNEY_NOTICE]);
    expect(notices[0]).toContain('not an attorney licensed to practice law in this Commonwealth');
    expect(advertisingNoticesFor('pa')).toHaveLength(2);
  });

  it('carries the Department of State’s added limits: no drafting legal records, no legal or immigration advice, no fees for them', () => {
    expect(PA_ADVERTISING_NOTICE).toMatch(/draft legal records/);
    expect(PA_ADVERTISING_NOTICE).toMatch(/immigration/);
    expect(PA_ADVERTISING_NOTICE).toMatch(/charge a fee/);
  });

  it('links to the state’s commission search for Pennsylvania only', () => {
    expect(commissionVerificationUrlFor('PA')).toBe(PA_NOTARY_SEARCH_URL);
    expect(commissionVerificationUrlFor('pa')).toBe(PA_NOTARY_SEARCH_URL);
    expect(commissionVerificationUrlFor('TX')).toBeNull();
    expect(commissionVerificationUrlFor(null)).toBeNull();
    expect(PA_NOTARY_SEARCH_URL.startsWith('https://')).toBe(true);
  });

  it('says the general thing everywhere else', () => {
    expect(advertisingNoticesFor('TX')).toEqual([NON_ATTORNEY_NOTICE]);
    expect(advertisingNoticesFor(null)).toEqual([NON_ATTORNEY_NOTICE]);
  });

  it('never promises legal help or uses the word "notario"', () => {
    for (const notice of advertisingNoticesFor('PA')) {
      expect(notice.toLowerCase()).not.toContain('notario');
      expect(notice.toLowerCase()).not.toMatch(/\bi am an attorney\b/);
    }
  });
});

describe('the public page’s view of a notary', () => {
  const source = readFileSync(
    path.join(__dirname, '..', 'src', 'lib', 'public-notary.ts'),
    'utf8',
  );

  it('selects columns from an allow-list, so a new User column cannot leak', () => {
    expect(source).toMatch(/select:\s*\{/);
    expect(source).not.toMatch(/include:/);
  });

  it('never names a private column', () => {
    for (const forbidden of [
      'passwordHash',
      'commissionNumber',
      'eoPolicyNumber',
      'eoCoverageCents',
      'bondNumber',
      'readinessChecklist',
      'webhookSecret',
      'integration',
      'sessions',
      'journalEntries',
    ]) {
      expect(source, forbidden).not.toContain(forbidden);
    }
    // A fee's notes are the notary's own bookkeeping, not something to show a customer.
    expect(source).not.toMatch(/\bnotes:\s*true/);
    expect(source).not.toMatch(/\bemail:\s*true/);
    expect(source).not.toMatch(/\baddressLine1:\s*true/);
    expect(source).not.toMatch(/\bpostalCode:\s*true/);
  });
});

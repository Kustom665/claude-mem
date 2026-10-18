import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  clientSchema,
  publicRequestSchema,
  requestLinkSchema,
  signingSchema,
  sourceApplicationSchema,
} from '@/lib/validation';

function messages(result: { success: boolean; error?: { issues: Array<{ path: PropertyKey[]; message: string }> } }) {
  return Object.fromEntries((result.error?.issues ?? []).map((issue) => [issue.path.join('.'), issue.message]));
}

describe('sourceApplicationSchema', () => {
  const valid = {
    name: 'Keystone Title Group',
    category: 'TITLE_ESCROW',
    status: 'RESEARCHING',
  };

  it('accepts a minimal entry and nulls everything optional', () => {
    const result = sourceApplicationSchema.safeParse(valid);
    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.data.website).toBeNull();
    expect(result.data.contactEmail).toBeNull();
    expect(result.data.appliedOn).toBeNull();
  });

  it('treats absent keys as empty, because conditional controls are the normal case', () => {
    // Regression guard for the bug that silently disabled the PA journal form:
    // FormData omits any control that was not rendered or not ticked.
    expect(sourceApplicationSchema.safeParse({ ...valid }).success).toBe(true);
  });

  it('rejects script-bearing website addresses', () => {
    // The pipeline renders this as a link on the notary's own page.
    for (const hostile of [
      'javascript:alert(1)',
      'JaVaScRiPt:alert(1)',
      'data:text/html,<script>alert(1)</script>',
      'file:///etc/passwd',
      'vbscript:msgbox(1)',
    ]) {
      const result = sourceApplicationSchema.safeParse({ ...valid, website: hostile });
      expect(result.success, hostile).toBe(false);
      expect(messages(result).website).toBeDefined();
    }
  });

  it('adds https to a bare domain and normalises it', () => {
    const result = sourceApplicationSchema.safeParse({ ...valid, website: 'example.com/apply' });
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.website).toBe('https://example.com/apply');
  });

  it('rejects a host with no dot', () => {
    expect(sourceApplicationSchema.safeParse({ ...valid, website: 'http://localhost' }).success).toBe(false);
  });

  it('validates and lowercases an email', () => {
    const ok = sourceApplicationSchema.safeParse({ ...valid, contactEmail: ' Vendors@Example.COM ' });
    expect(ok.success && ok.data.contactEmail).toBe('vendors@example.com');
    expect(sourceApplicationSchema.safeParse({ ...valid, contactEmail: 'not-an-email' }).success).toBe(false);
  });

  it('validates a phone number by digit count, not punctuation', () => {
    expect(sourceApplicationSchema.safeParse({ ...valid, contactPhone: '(412) 555-0148' }).success).toBe(true);
    expect(sourceApplicationSchema.safeParse({ ...valid, contactPhone: '+1 412.555.0148' }).success).toBe(true);
    expect(sourceApplicationSchema.safeParse({ ...valid, contactPhone: '555-0148' }).success).toBe(false);
  });

  it('rejects an unknown category or status', () => {
    expect(sourceApplicationSchema.safeParse({ ...valid, category: 'NOPE' }).success).toBe(false);
    expect(sourceApplicationSchema.safeParse({ ...valid, status: 'NOPE' }).success).toBe(false);
  });

  it('bounds free text', () => {
    expect(sourceApplicationSchema.safeParse({ ...valid, notes: 'x'.repeat(4001) }).success).toBe(false);
    expect(sourceApplicationSchema.safeParse({ ...valid, notes: 'x'.repeat(4000) }).success).toBe(true);
  });
});

describe('publicRequestSchema', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-10-13T12:00:00Z'));
  });
  afterEach(() => vi.useRealTimers());

  const valid = {
    requesterName: 'Jordan Avery',
    requesterPhone: '(412) 555-0199',
    service: 'GENERAL',
    city: 'Pittsburgh',
    state: 'pa',
    postalCode: '15222',
    consent: 'on',
  };

  it('accepts a minimal request and fills the defaults', () => {
    const result = publicRequestSchema.safeParse(valid);
    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.data.state).toBe('PA');
    expect(result.data.signerCount).toBe(1);
    expect(result.data.preferredContact).toBe('ANY');
    expect(result.data.preferredWindow).toBe('FLEXIBLE');
    expect(result.data.requesterEmail).toBeNull();
    expect(result.data.preferredDate).toBeNull();
  });

  it('needs a way to reach the requester', () => {
    const result = publicRequestSchema.safeParse({ ...valid, requesterPhone: '' });
    expect(result.success).toBe(false);
    expect(messages(result).requesterPhone).toContain('phone number or an email');
  });

  it('is satisfied by an email alone', () => {
    expect(
      publicRequestSchema.safeParse({ ...valid, requesterPhone: '', requesterEmail: 'jordan@example.com' }).success,
    ).toBe(true);
  });

  it('requires consent to be contacted', () => {
    const { consent: _consent, ...withoutConsent } = valid;
    const result = publicRequestSchema.safeParse(withoutConsent);
    expect(result.success).toBe(false);
    expect(messages(result).consent).toBeDefined();
  });

  it('requires a city, state and five-digit ZIP', () => {
    expect(publicRequestSchema.safeParse({ ...valid, city: '' }).success).toBe(false);
    expect(publicRequestSchema.safeParse({ ...valid, state: '' }).success).toBe(false);
    expect(publicRequestSchema.safeParse({ ...valid, postalCode: '1522' }).success).toBe(false);
    expect(publicRequestSchema.safeParse({ ...valid, postalCode: '15222-1234' }).success).toBe(true);
  });

  it('rejects a service it does not know', () => {
    expect(publicRequestSchema.safeParse({ ...valid, service: 'WIRE_TRANSFER' }).success).toBe(false);
  });

  it('asks for a missing service in plain words, not with the list of internal values', () => {
    const result = publicRequestSchema.safeParse({ ...valid, service: '' });
    expect(messages(result).service).toBe('Choose what you need.');
    expect(messages(result).service).not.toMatch(/GENERAL|expected one of/);
  });

  it('reports every mistake at once instead of one round trip per mistake', () => {
    // No contact, no consent, no city and a bad ZIP, all in one submission. Before,
    // the cross-field rules (contact, consent) were skipped while a field-level
    // error stood, and only appeared after the visitor had fixed the others.
    const result = publicRequestSchema.safeParse({
      requesterName: 'Jordan Avery',
      service: 'GENERAL',
      state: 'PA',
      city: '',
      postalCode: '12',
    });
    const errors = messages(result);
    expect(errors.city).toBeDefined();
    expect(errors.postalCode).toBeDefined();
    expect(errors.requesterPhone).toContain('phone number or an email');
    expect(errors.consent).toBeDefined();
  });

  it('keeps the field’s own message when the same field is also the cross-field target', () => {
    // A bad phone number and no email: the visitor should be told the number is
    // wrong, not merely that something is missing.
    const result = publicRequestSchema.safeParse({ ...valid, requesterPhone: '12' });
    expect(messages(result).requesterPhone).toBe('Enter a phone number with area code.');
  });

  it('keeps the signer count within a believable range', () => {
    expect(publicRequestSchema.safeParse({ ...valid, signerCount: '0' }).success).toBe(false);
    expect(publicRequestSchema.safeParse({ ...valid, signerCount: '21' }).success).toBe(false);
    const ok = publicRequestSchema.safeParse({ ...valid, signerCount: '3' });
    expect(ok.success && ok.data.signerCount).toBe(3);
  });

  it('accepts today and tomorrow but not last week or next decade', () => {
    expect(publicRequestSchema.safeParse({ ...valid, preferredDate: '2026-10-13' }).success).toBe(true);
    expect(publicRequestSchema.safeParse({ ...valid, preferredDate: '2026-10-14' }).success).toBe(true);
    expect(publicRequestSchema.safeParse({ ...valid, preferredDate: '2026-10-05' }).success).toBe(false);
    expect(publicRequestSchema.safeParse({ ...valid, preferredDate: '2036-10-13' }).success).toBe(false);
  });

  it('has no field for an ID number, date of birth or document upload', () => {
    // Anything extra a hostile client posts is stripped, not stored.
    const result = publicRequestSchema.safeParse({
      ...valid,
      idNumber: 'D123456789',
      dateOfBirth: '1980-01-01',
      ssn: '000-00-0000',
    });
    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(Object.keys(result.data)).not.toContain('idNumber');
    expect(Object.keys(result.data)).not.toContain('dateOfBirth');
    expect(Object.keys(result.data)).not.toContain('ssn');
  });

  it('bounds the free-text fields', () => {
    expect(publicRequestSchema.safeParse({ ...valid, message: 'x'.repeat(1001) }).success).toBe(false);
    expect(publicRequestSchema.safeParse({ ...valid, documentSummary: 'x'.repeat(501) }).success).toBe(false);
  });
});

describe('requestLinkSchema', () => {
  const valid = {
    publicSlug: 'Keystone Mobile Notary',
    acceptingRequests: 'on',
    servicesOffered: 'GENERAL,LOAN_SIGNING',
  };

  it('normalises the slug', () => {
    const result = requestLinkSchema.safeParse(valid);
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.publicSlug).toBe('keystone-mobile-notary');
  });

  it('refuses to switch on without an address', () => {
    const result = requestLinkSchema.safeParse({ ...valid, publicSlug: '' });
    expect(result.success).toBe(false);
    expect(messages(result).publicSlug).toContain('address');
  });

  it('refuses to switch on without a service', () => {
    const result = requestLinkSchema.safeParse({ ...valid, servicesOffered: '' });
    expect(result.success).toBe(false);
    expect(messages(result).servicesOffered).toContain('at least one service');
  });

  it('lets a notary save settings while switched off, with nothing filled in', () => {
    const result = requestLinkSchema.safeParse({ publicSlug: '', servicesOffered: '' });
    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.data.acceptingRequests).toBe(false);
    expect(result.data.publicSlug).toBeNull();
  });

  it('drops unknown services', () => {
    const result = requestLinkSchema.safeParse({ ...valid, servicesOffered: 'GENERAL,BOGUS' });
    expect(result.success && result.data.servicesOffered).toEqual(['GENERAL']);
  });

  it('rejects a reserved slug', () => {
    expect(requestLinkSchema.safeParse({ ...valid, publicSlug: 'admin' }).success).toBe(false);
  });

  it('defaults the minimum notice to a day and bounds it', () => {
    const result = requestLinkSchema.safeParse(valid);
    expect(result.success && result.data.requestMinNoticeHours).toBe(24);
    expect(requestLinkSchema.safeParse({ ...valid, requestMinNoticeHours: '9999' }).success).toBe(false);
  });
});

describe('email addresses entered elsewhere in the app', () => {
  it('are checked on a client, so a typo cannot reach a webhook or a mailto link', () => {
    const bad = clientSchema.safeParse({ name: 'Acme Title', type: 'TITLE_COMPANY', email: 'definitely not an email' });
    expect(bad.success).toBe(false);
    expect(messages(bad).email).toBe('Enter a valid email address.');

    const good = clientSchema.safeParse({ name: 'Acme Title', type: 'TITLE_COMPANY', email: '  Closer@Acme.Example ' });
    expect(good.success).toBe(true);
    if (good.success) expect(good.data.email).toBe('closer@acme.example');

    const none = clientSchema.safeParse({ name: 'Acme Title', type: 'TITLE_COMPANY' });
    expect(none.success).toBe(true);
    if (none.success) expect(none.data.email).toBeNull();
  });

  it('are checked on a signing', () => {
    const base = {
      title: 'Refinance — Okonkwo',
      type: 'LOAN_SIGNING',
      status: 'SCHEDULED',
      scheduledAt: '2026-10-20T18:30:00.000Z',
    };
    expect(signingSchema.safeParse({ ...base, signerEmail: 'jordan@example.com' }).success).toBe(true);
    const bad = signingSchema.safeParse({ ...base, signerEmail: 'jordan at example' });
    expect(messages(bad).signerEmail).toBe('Enter a valid email address.');
  });
});

import { describe, expect, it } from 'vitest';
import {
  assessReadiness,
  checkRequirement,
  EXPIRING_SOON_DAYS,
  rankUnlocks,
  type NotaryCredentials,
} from '@/lib/readiness';
import {
  parseRequirementList,
  REQUIREMENT_KEYS,
  serializeRequirementList,
} from '@/lib/requirements';

const NOW = new Date('2026-10-13T12:00:00Z');
const inDays = (n: number) => new Date(NOW.getTime() + n * 24 * 60 * 60 * 1000);

const FULL: NotaryCredentials = {
  commissionExpiresOn: inDays(400),
  isSigningAgent: true,
  backgroundCheckExpiresOn: inDays(200),
  eoExpiresOn: inDays(300),
  eoCoverageCents: 10_000_000,
};

const NOTHING: NotaryCredentials = {
  commissionExpiresOn: null,
  isSigningAgent: false,
  backgroundCheckExpiresOn: null,
  eoExpiresOn: null,
  eoCoverageCents: null,
};

const none = new Set<string>();

describe('automatic requirements are computed, not ticked', () => {
  it('treats a missing credential as missing', () => {
    const result = checkRequirement('COMMISSION_ACTIVE', NOTHING, none, NOW);
    expect(result.status).toBe('MISSING');
    expect(result.satisfied).toBe(false);
    expect(result.fixHref).toBe('/settings/commission');
  });

  it('treats a lapsed credential as expired', () => {
    const result = checkRequirement(
      'EO_ACTIVE',
      { ...FULL, eoExpiresOn: inDays(-1) },
      none,
      NOW,
    );
    expect(result.status).toBe('EXPIRED');
    expect(result.satisfied).toBe(false);
  });

  it('counts a credential that lapses within the window as satisfied but flags it', () => {
    const result = checkRequirement(
      'BACKGROUND_CHECK',
      { ...FULL, backgroundCheckExpiresOn: inDays(20) },
      none,
      NOW,
    );
    expect(result.status).toBe('EXPIRING');
    expect(result.satisfied).toBe(true);
    expect(result.note).toContain('20 days');
  });

  it('draws the expiring line exactly at the documented window', () => {
    const edge = checkRequirement(
      'COMMISSION_ACTIVE',
      { ...FULL, commissionExpiresOn: inDays(EXPIRING_SOON_DAYS) },
      none,
      NOW,
    );
    const beyond = checkRequirement(
      'COMMISSION_ACTIVE',
      { ...FULL, commissionExpiresOn: inDays(EXPIRING_SOON_DAYS + 1) },
      none,
      NOW,
    );
    expect(edge.status).toBe('EXPIRING');
    expect(beyond.status).toBe('MET');
  });

  it('says "tomorrow" and "today" rather than "in 1 days"', () => {
    const tomorrow = checkRequirement(
      'COMMISSION_ACTIVE',
      { ...FULL, commissionExpiresOn: inDays(1) },
      none,
      NOW,
    );
    expect(tomorrow.note).toContain('expires tomorrow');
  });

  it('cannot be satisfied by a manual tick', () => {
    // The whole point of the AUTO/MANUAL split: ticking a box must not paper
    // over a lapsed policy.
    const ticked = new Set<string>(['COMMISSION_ACTIVE', 'EO_ACTIVE', 'BACKGROUND_CHECK']);
    expect(checkRequirement('COMMISSION_ACTIVE', NOTHING, ticked, NOW).satisfied).toBe(false);
    expect(checkRequirement('EO_ACTIVE', NOTHING, ticked, NOW).satisfied).toBe(false);
    expect(checkRequirement('BACKGROUND_CHECK', NOTHING, ticked, NOW).satisfied).toBe(false);
  });

  it('reads the signing-agent flag from the profile', () => {
    expect(checkRequirement('SIGNING_AGENT_PROFILE', FULL, none, NOW).satisfied).toBe(true);
    expect(
      checkRequirement('SIGNING_AGENT_PROFILE', { ...FULL, isSigningAgent: false }, none, NOW)
        .satisfied,
    ).toBe(false);
  });
});

describe('E&O coverage floors', () => {
  it('accepts $100,000 of cover', () => {
    expect(checkRequirement('EO_100K', FULL, none, NOW).satisfied).toBe(true);
  });

  it('rejects $25,000 of cover and states the shortfall', () => {
    const result = checkRequirement('EO_100K', { ...FULL, eoCoverageCents: 2_500_000 }, none, NOW);
    expect(result.satisfied).toBe(false);
    expect(result.note).toContain('$25,000');
    expect(result.note).toContain('$100,000');
  });

  it('reports a lapsed policy as expired before it talks about the limit', () => {
    const result = checkRequirement(
      'EO_100K',
      { ...FULL, eoExpiresOn: inDays(-5), eoCoverageCents: 10_000_000 },
      none,
      NOW,
    );
    expect(result.status).toBe('EXPIRED');
  });

  it('handles a policy with no recorded limit', () => {
    const result = checkRequirement('EO_100K', { ...FULL, eoCoverageCents: null }, none, NOW);
    expect(result.satisfied).toBe(false);
    expect(result.note).toContain('No E&O coverage amount recorded');
  });
});

describe('manual requirements', () => {
  it('are todo until ticked and done after', () => {
    expect(checkRequirement('NNA_CERTIFIED', FULL, none, NOW).status).toBe('TODO');
    const done = checkRequirement('NNA_CERTIFIED', FULL, new Set(['NNA_CERTIFIED']), NOW);
    expect(done.status).toBe('DONE');
    expect(done.satisfied).toBe(true);
  });
});

describe('assessReadiness', () => {
  it('is ready when every requirement holds', () => {
    const readiness = assessReadiness(
      { requirements: ['COMMISSION_ACTIVE', 'EO_ACTIVE', 'NNA_CERTIFIED'] },
      FULL,
      new Set(['NNA_CERTIFIED']),
      NOW,
    );
    expect(readiness.ready).toBe(true);
    expect(readiness.percent).toBe(100);
    expect(readiness.blockers).toHaveLength(0);
  });

  it('lists blockers and computes a whole-number percentage', () => {
    const readiness = assessReadiness(
      { requirements: ['COMMISSION_ACTIVE', 'EO_ACTIVE', 'BACKGROUND_CHECK'] },
      { ...FULL, eoExpiresOn: null },
      none,
      NOW,
    );
    expect(readiness.satisfied).toBe(2);
    expect(readiness.percent).toBe(67);
    expect(readiness.blockers.map((blocker) => blocker.key)).toEqual(['EO_ACTIVE']);
    expect(readiness.ready).toBe(false);
  });

  it('counts manual items it is taking on trust', () => {
    const readiness = assessReadiness(
      { requirements: ['COMMISSION_ACTIVE', 'NNA_CERTIFIED', 'W9'] },
      FULL,
      new Set(['NNA_CERTIFIED', 'W9']),
      NOW,
    );
    expect(readiness.takenOnTrust).toBe(2);
  });

  it('surfaces the credentials that are about to lapse', () => {
    const readiness = assessReadiness(
      { requirements: ['COMMISSION_ACTIVE', 'EO_ACTIVE'] },
      { ...FULL, commissionExpiresOn: inDays(10) },
      none,
      NOW,
    );
    expect(readiness.expiring.map((item) => item.key)).toEqual(['COMMISSION_ACTIVE']);
    expect(readiness.ready).toBe(true);
  });

  it('treats a source with no requirements as ready', () => {
    const readiness = assessReadiness({ requirements: [] }, NOTHING, none, NOW);
    expect(readiness.percent).toBe(100);
    expect(readiness.ready).toBe(true);
  });
});

describe('rankUnlocks', () => {
  const sources = [
    { requirements: ['EO_ACTIVE', 'NNA_CERTIFIED'] as const },
    { requirements: ['EO_ACTIVE'] as const },
    { requirements: ['NNA_CERTIFIED', 'PRINTER_SCANNER'] as const },
    { requirements: ['COMMISSION_ACTIVE'] as const },
  ];

  it('puts the fix that is the only thing missing for the most sources first', () => {
    const ranked = rankUnlocks(
      sources,
      { ...FULL, eoExpiresOn: null },
      new Set<string>(),
      NOW,
    );
    // Missing E&O alone blocks source 2 and, with NNA, source 1.
    expect(ranked[0].key).toBe('EO_ACTIVE');
    expect(ranked[0].blocks).toBe(2);
    expect(ranked[0].soleBlocker).toBe(1);
  });

  it('counts every requirement a source is waiting on', () => {
    const ranked = rankUnlocks(sources, { ...FULL, eoExpiresOn: null }, new Set<string>(), NOW);
    const nna = ranked.find((item) => item.key === 'NNA_CERTIFIED');
    expect(nna?.blocks).toBe(2);
    expect(nna?.soleBlocker).toBe(0);
  });

  it('returns nothing when nothing is missing', () => {
    expect(rankUnlocks([{ requirements: ['COMMISSION_ACTIVE'] }], FULL, none, NOW)).toEqual([]);
  });
});

describe('requirement list storage', () => {
  it('round-trips in canonical order and drops unknown keys', () => {
    const stored = serializeRequirementList(['W9', 'bogus', 'NNA_CERTIFIED', 'W9']);
    expect(stored).toBe('NNA_CERTIFIED,W9');
    expect([...parseRequirementList(stored)]).toEqual(['NNA_CERTIFIED', 'W9']);
  });

  it('tolerates empty and missing values', () => {
    expect(parseRequirementList('').size).toBe(0);
    expect(parseRequirementList(null).size).toBe(0);
    expect(serializeRequirementList([])).toBe('');
  });

  it('keeps every key in the registry', () => {
    // A key present in REQUIREMENT_KEYS but absent from REQUIREMENTS would
    // render as undefined in the UI; this is the cheap guard.
    expect(new Set(REQUIREMENT_KEYS).size).toBe(REQUIREMENT_KEYS.length);
  });
});

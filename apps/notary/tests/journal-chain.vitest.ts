import { describe, expect, it } from 'vitest';
import {
  GENESIS_HASH,
  canonicalizeEntry,
  computeEntryHash,
  shortHash,
  verifyChain,
  type SealedEntry,
} from '../src/lib/journal-chain';

/**
 * The chain is the product's central claim — that a journal entry cannot be
 * altered without it being detectable. These tests are the evidence for that
 * claim, so they attack it rather than demonstrate the happy path.
 */

function entry(overrides: Partial<SealedEntry> & { sequenceNumber: number }): SealedEntry {
  return {
    performedAt: new Date('2026-03-01T15:00:00.000Z'),
    actType: 'ACKNOWLEDGMENT',
    documentType: 'Mortgage',
    documentDate: null,
    documentDescription: null,
    numberOfSignatures: 1,
    signerName: 'Adaeze Okonkwo',
    signerAddressLine1: null,
    signerCity: 'Pittsburgh',
    signerState: 'PA',
    signerPostalCode: null,
    signerPhone: null,
    signerEmail: null,
    identityMethod: 'IDENTIFICATION_DOCUMENT',
    idType: "Driver's license",
    idIssuer: 'Pennsylvania',
    idNumberLast4: '4821',
    idIssuedOn: null,
    idExpiresOn: null,
    credibleWitnessName: null,
    credibleWitnessAddress: null,
    secondCredibleWitnessName: null,
    feeChargedCents: 500,
    travelFeeCents: 0,
    notarizedRemotely: false,
    ronPlatform: null,
    thumbprintTaken: false,
    witnessNames: null,
    locationCity: 'Pittsburgh',
    locationState: 'PA',
    notes: null,
    signingId: null,
    sealedAt: new Date('2026-03-01T15:01:00.000Z'),
    amendsEntryId: null,
    amendmentReason: null,
    previousHash: null,
    entryHash: '',
    ...overrides,
  } as SealedEntry;
}

/** Build a valid chain of n entries. */
function buildChain(count: number): SealedEntry[] {
  const entries: SealedEntry[] = [];
  let previousHash: string | null = null;

  for (let i = 0; i < count; i += 1) {
    const candidate = entry({
      sequenceNumber: i + 1,
      signerName: `Signer ${i + 1}`,
      feeChargedCents: 500,
      previousHash,
    });
    candidate.entryHash = computeEntryHash(candidate, previousHash);
    previousHash = candidate.entryHash;
    entries.push(candidate);
  }

  return entries;
}

describe('computeEntryHash', () => {
  it('is deterministic for identical input', () => {
    const a = entry({ sequenceNumber: 1 });
    const b = entry({ sequenceNumber: 1 });
    expect(computeEntryHash(a, null)).toBe(computeEntryHash(b, null));
  });

  it('changes when any covered field changes', () => {
    const base = entry({ sequenceNumber: 1 });
    const baseline = computeEntryHash(base, null);

    const mutations: Array<Partial<SealedEntry>> = [
      { signerName: 'Adaeze Okonkwa' },
      { feeChargedCents: 501 },
      { actType: 'JURAT' },
      { documentType: 'Deed of Trust' },
      { idNumberLast4: '4822' },
      { thumbprintTaken: true },
      { notes: 'added later' },
      { performedAt: new Date('2026-03-01T15:00:01.000Z') },
      { numberOfSignatures: 2 },
    ];

    for (const mutation of mutations) {
      const mutated = entry({ sequenceNumber: 1, ...mutation });
      expect(
        computeEntryHash(mutated, null),
        `mutating ${Object.keys(mutation)[0]} must change the digest`,
      ).not.toBe(baseline);
    }
  });

  it('depends on the predecessor digest', () => {
    const single = entry({ sequenceNumber: 2 });
    expect(computeEntryHash(single, 'aaa')).not.toBe(computeEntryHash(single, 'bbb'));
    expect(computeEntryHash(single, null)).toBe(computeEntryHash(single, GENESIS_HASH));
  });

  it('treats an ISO string date and a Date object as equal', () => {
    // Matters because a SQLite driver returns Date objects while a Postgres
    // driver may return strings; a chain must survive that migration.
    const asDate = entry({ sequenceNumber: 1 });
    const asString = entry({
      sequenceNumber: 1,
      performedAt: '2026-03-01T15:00:00.000Z' as unknown as Date,
      sealedAt: '2026-03-01T15:01:00.000Z',
    });
    expect(computeEntryHash(asString, null)).toBe(computeEntryHash(asDate, null));
  });

  it('does not confuse adjacent field values', () => {
    // "ab" + "c" must not hash the same as "a" + "bc".
    const a = entry({ sequenceNumber: 1, documentType: 'Deed', documentDescription: 'of Trust' });
    const b = entry({ sequenceNumber: 1, documentType: 'Deedof', documentDescription: 'Trust' });
    expect(computeEntryHash(a, null)).not.toBe(computeEntryHash(b, null));
  });
});

describe('canonicalizeEntry', () => {
  // Field name and value are joined by U+0000, fields by U+0001. Control
  // characters are used because they cannot appear in a field value, which is
  // what prevents adjacent fields from running together into a collision.
  const FV = '\u0000';

  it('produces a reproducible string an auditor can verify by hand', () => {
    const canonical = canonicalizeEntry(entry({ sequenceNumber: 7 }));
    expect(canonical).toContain(`sequenceNumber${FV}num:7`);
    expect(canonical).toContain(`signerName${FV}str:Adaeze Okonkwo`);
    expect(canonical).toContain(`feeChargedCents${FV}num:500`);
    expect(canonical).toContain(`thumbprintTaken${FV}bool:0`);
    expect(canonical).toContain(`notes${FV}null`);
  });

  it('emits every hashed field, so nothing silently escapes the digest', () => {
    const canonical = canonicalizeEntry(entry({ sequenceNumber: 1 }));
    const pairs = canonical.split('\u0001');
    expect(pairs).toHaveLength(36);
    // Every element is exactly one name/value pair.
    for (const pair of pairs) {
      expect(pair.split(FV)).toHaveLength(2);
    }
  });
});

describe('verifyChain', () => {
  it('accepts an untampered chain', () => {
    const result = verifyChain(buildChain(5));
    expect(result.ok).toBe(true);
    expect(result.breaks).toEqual([]);
    expect(result.entriesChecked).toBe(5);
  });

  it('accepts an empty journal', () => {
    const result = verifyChain([]);
    expect(result.ok).toBe(true);
    expect(result.headHash).toBeNull();
  });

  it('detects an edited historical entry', () => {
    const chain = buildChain(5);
    // Someone raises a recorded fee after the fact.
    chain[2].feeChargedCents = 5000;

    const result = verifyChain(chain);
    expect(result.ok).toBe(false);
    const mismatch = result.breaks.find((issue) => issue.kind === 'HASH_MISMATCH');
    expect(mismatch?.sequenceNumber).toBe(3);
  });

  it('reports a single edit once rather than cascading', () => {
    const chain = buildChain(6);
    chain[1].signerName = 'Someone Else';

    const result = verifyChain(chain);
    const mismatches = result.breaks.filter((issue) => issue.kind === 'HASH_MISMATCH');
    expect(mismatches).toHaveLength(1);
    expect(mismatches[0].sequenceNumber).toBe(2);
  });

  it('detects a deleted entry', () => {
    const chain = buildChain(5);
    chain.splice(2, 1);

    const result = verifyChain(chain);
    expect(result.ok).toBe(false);
    expect(result.breaks.some((issue) => issue.kind === 'SEQUENCE_GAP')).toBe(true);
  });

  it('detects a spliced-in entry whose digest is internally valid', () => {
    // The hardest case: an attacker inserts a well-formed entry but cannot
    // relink the entry that follows it.
    const chain = buildChain(4);
    const forged = entry({
      sequenceNumber: 3,
      signerName: 'Forged Entry',
      previousHash: chain[1].entryHash,
    });
    forged.entryHash = computeEntryHash(forged, forged.previousHash);
    chain[2] = forged;

    const result = verifyChain(chain);
    expect(result.ok).toBe(false);
    expect(result.breaks.some((issue) => issue.kind === 'BROKEN_LINK')).toBe(true);
  });

  it('detects duplicated journal numbers', () => {
    const chain = buildChain(3);
    chain[2].sequenceNumber = 2;

    const result = verifyChain(chain);
    expect(result.ok).toBe(false);
    expect(result.breaks.some((issue) => issue.kind === 'DUPLICATE_SEQUENCE')).toBe(true);
  });

  it('sorts before verifying, so read order does not matter', () => {
    const chain = buildChain(4);
    const shuffled = [chain[3], chain[0], chain[2], chain[1]];
    expect(verifyChain(shuffled).ok).toBe(true);
  });

  it('respects a configured starting number', () => {
    const entries: SealedEntry[] = [];
    let previousHash: string | null = null;
    for (let i = 0; i < 3; i += 1) {
      const candidate = entry({ sequenceNumber: 1001 + i, previousHash });
      candidate.entryHash = computeEntryHash(candidate, previousHash);
      previousHash = candidate.entryHash;
      entries.push(candidate);
    }

    // Told the journal begins at 1001, there is no gap.
    expect(verifyChain(entries, 1001).ok).toBe(true);
    // Told it begins at 1, the missing 1000 entries are reported.
    expect(verifyChain(entries, 1).ok).toBe(false);
  });

  it('returns the head digest for external anchoring', () => {
    const chain = buildChain(3);
    expect(verifyChain(chain).headHash).toBe(chain[2].entryHash);
  });
});

describe('shortHash', () => {
  it('abbreviates a digest and handles absence', () => {
    expect(shortHash('0123456789abcdef0123456789abcdef')).toBe('01234567…cdef');
    expect(shortHash(null)).toBe('—');
  });
});

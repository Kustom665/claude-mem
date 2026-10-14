import { describe, expect, it } from 'vitest';
import { computeEntryHash, verifyChain, type SealedEntry } from '../src/lib/journal-chain';
import migratedRows from './fixtures/postgres-migrated-journal.json';

/**
 * A journal must survive moving between database engines.
 *
 * The README tells a notary they can migrate their data and re-verify, and
 * that claim is worth more than most of the feature list: a journal whose
 * chain breaks on a routine infrastructure change is a journal that cries
 * tampering when nothing was tampered with, and a notary who has seen one
 * false alarm will not trust the next real one.
 *
 * The rows in the fixture are the real thing. They were sealed under SQLite
 * with `better-sqlite3`, copied into PostgreSQL, and read back out. Nothing
 * recomputed the digests along the way — the `entryHash` values are the ones
 * written at seal time, and this file asserts they still check out.
 */

// Prisma's `DateTime` becomes `timestamp(3)` — *without* time zone — on
// PostgreSQL, so these come back with no zone marker: "2026-07-22T17:45:00".
const DATE_FIELDS = [
  'performedAt',
  'documentDate',
  'idIssuedOn',
  'idExpiresOn',
  'sealedAt',
] as const;

/** How Prisma's pg adapter hands the rows to the app: dates as `Date`. */
function asPrismaReturnsThem(): SealedEntry[] {
  return migratedRows.map((row) => {
    const copy: Record<string, unknown> = { ...row };
    for (const field of DATE_FIELDS) {
      const value = (row as Record<string, unknown>)[field];
      if (typeof value === 'string') copy[field] = new Date(`${value}Z`);
    }
    return copy as unknown as SealedEntry;
  });
}

/** How a SQL client or CSV dump hands them over: dates as bare strings. */
function asRawSqlReturnsThem(): SealedEntry[] {
  return migratedRows as unknown as SealedEntry[];
}

const HEAD_HASH = '37dc3c9e3513078eefc29741abe3d52ae9700f2d247f4ddd070ab361412002ea';

describe('a journal moved from SQLite to PostgreSQL', () => {
  it('still verifies when read through Prisma', () => {
    const result = verifyChain(asPrismaReturnsThem(), 1);

    expect(result.breaks).toEqual([]);
    expect(result.ok).toBe(true);
    expect(result.entriesChecked).toBe(12);
    expect(result.headHash).toBe(HEAD_HASH);
  });

  it('still verifies when read straight out of SQL as strings', () => {
    // An auditor re-checking a journal will not be going through Prisma. They
    // will have a dump, and every date in it will be an offset-less string.
    // Those have to normalise to the same instant as the Date objects above,
    // or an export is unverifiable by anyone but the app that wrote it.
    const result = verifyChain(asRawSqlReturnsThem(), 1);

    expect(result.breaks).toEqual([]);
    expect(result.ok).toBe(true);
    expect(result.headHash).toBe(HEAD_HASH);
  });
});

describe('timestamp normalisation', () => {
  it('agrees across every spelling an engine might produce', () => {
    const sameInstant = [
      new Date('2026-07-22T17:45:00.000Z'),
      '2026-07-22T17:45:00.000Z',
      '2026-07-22T17:45:00Z',
      '2026-07-22T17:45:00+00:00',
      '2026-07-22T17:45:00', // PostgreSQL `timestamp without time zone`
      '2026-07-22 17:45:00', // space separator, as some clients render it
    ];

    const digests = new Set(
      sameInstant.map((performedAt) =>
        computeEntryHash({ sequenceNumber: 1, sealedAt: '2026-01-01T00:00:00Z', performedAt }, null),
      ),
    );

    expect(digests.size).toBe(1);
  });

  it('reads an offset-less timestamp as UTC, not as local time', () => {
    // If a bare timestamp were parsed in the local zone, a digest would depend
    // on the TZ of whoever is verifying — the same journal would pass in
    // Pittsburgh and fail in Berlin.
    const bare = computeEntryHash(
      { sequenceNumber: 1, sealedAt: '2026-01-01T00:00:00Z', performedAt: '2026-07-22T17:45:00' },
      null,
    );
    const explicitUtc = computeEntryHash(
      { sequenceNumber: 1, sealedAt: '2026-01-01T00:00:00Z', performedAt: '2026-07-22T17:45:00Z' },
      null,
    );

    expect(bare).toBe(explicitUtc);
  });

  it('still treats a non-timestamp string as a string', () => {
    const asText = computeEntryHash(
      { sequenceNumber: 1, sealedAt: '2026-01-01T00:00:00Z', notes: '2026-07-22' },
      null,
    );
    const asDate = computeEntryHash(
      { sequenceNumber: 1, sealedAt: '2026-01-01T00:00:00Z', notes: '2026-07-22T00:00:00' },
      null,
    );

    expect(asText).not.toBe(asDate);
  });
});

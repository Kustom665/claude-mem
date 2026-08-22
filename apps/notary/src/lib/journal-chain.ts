import { createHash } from 'node:crypto';

/**
 * Tamper-evident journal chaining.
 *
 * Every sealed journal entry stores a SHA-256 digest computed over its own
 * substantive fields *plus* the digest of the entry before it. Altering any
 * field of any historical entry — or deleting one, or splicing one in — breaks
 * the digest of that entry and every entry after it, and `verifyChain` reports
 * exactly where the break starts.
 *
 * This does not make records unalterable; anyone with database access can
 * rewrite rows. What it does is make alteration *detectable*, which is the
 * property that matters when a journal is produced in response to a subpoena or
 * a commissioning-authority audit. Corrections are therefore additive: a
 * mistake is fixed by appending an amending entry, never by editing a sealed
 * one.
 */

/** Digest standing in for the predecessor of the very first entry. */
export const GENESIS_HASH = 'GENESIS';

const HASH_ALGORITHM = 'sha256';

/**
 * The fields that are covered by the digest, in a fixed order.
 *
 * Order is part of the format: changing it invalidates every existing chain, so
 * append new fields at the end rather than inserting them. Fields deliberately
 * excluded are the row id (random, carries no record meaning), createdAt
 * (bookkeeping, duplicated by sealedAt) and entryHash itself.
 */
const HASHED_FIELDS = [
  'sequenceNumber',
  'performedAt',
  'actType',
  'documentType',
  'documentDate',
  'documentDescription',
  'numberOfSignatures',
  'signerName',
  'signerAddressLine1',
  'signerCity',
  'signerState',
  'signerPostalCode',
  'signerPhone',
  'signerEmail',
  'identityMethod',
  'idType',
  'idIssuer',
  'idNumberLast4',
  'idIssuedOn',
  'idExpiresOn',
  'credibleWitnessName',
  'credibleWitnessAddress',
  'secondCredibleWitnessName',
  'feeChargedCents',
  'travelFeeCents',
  'notarizedRemotely',
  'ronPlatform',
  'thumbprintTaken',
  'witnessNames',
  'locationCity',
  'locationState',
  'notes',
  'signingId',
  'sealedAt',
  'amendsEntryId',
  'amendmentReason',
] as const;

export type HashedField = (typeof HASHED_FIELDS)[number];

/**
 * Separators used to build the canonical string.
 *
 * Control characters rather than spaces or commas, because they cannot occur in
 * any field value that reaches this code. That closes an otherwise real
 * collision: with a printable separator, a document type of "Deed" plus a
 * description of "of Trust" would canonicalise identically to "Deedof" plus
 * "Trust", and two materially different journal entries would share a digest.
 */
const FIELD_VALUE_SEPARATOR = '\u0000';
const FIELD_SEPARATOR = '\u0001';
const CHAIN_SEPARATOR = '\u0002';

/** The shape `computeEntryHash` needs. Extra properties are ignored. */
export type ChainableEntry = {
  [K in HashedField]?: unknown;
} & {
  sequenceNumber: number;
  sealedAt: Date | string;
};

export type SealedEntry = ChainableEntry & {
  previousHash: string | null;
  entryHash: string;
};

/**
 * Normalise a value into a form whose string encoding is stable across
 * platforms, database drivers and JS engines.
 *
 * SQLite hands back dates as Date objects while a Postgres driver may hand back
 * strings; both must hash identically or a chain verified after a database
 * migration would falsely report tampering.
 */
function normalizeValue(value: unknown): string {
  if (value === null || value === undefined) return 'null';
  if (value instanceof Date) return `date:${value.toISOString()}`;
  if (typeof value === 'boolean') return `bool:${value ? '1' : '0'}`;
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) {
      throw new Error(`Cannot hash non-finite number: ${value}`);
    }
    // Integers are written without an exponent so 1e3 and 1000 agree.
    return `num:${Number.isInteger(value) ? value.toFixed(0) : String(value)}`;
  }
  if (typeof value === 'string') {
    // Dates that arrived as strings are re-encoded through the Date branch so
    // '2026-01-01T00:00:00Z' and '2026-01-01T00:00:00.000Z' hash the same.
    const asDate = parseIsoDate(value);
    if (asDate) return `date:${asDate.toISOString()}`;
    return `str:${value.normalize('NFC')}`;
  }
  throw new Error(`Cannot hash value of type ${typeof value}`);
}

const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}:\d{2}(\.\d+)?(Z|[+-]\d{2}:?\d{2})?$/;

/**
 * The offset is optional because a `timestamp without time zone` column — which
 * is what Prisma's `DateTime` becomes on PostgreSQL — dumps as a bare
 * `2026-07-22T17:45:00` with no zone marker at all. Both SQLite and
 * node-postgres read such a column as UTC, so an absent offset is read as UTC
 * here too rather than falling back to the local zone, which would make a
 * digest depend on the verifying machine's TZ.
 */
function parseIsoDate(value: string): Date | null {
  if (!ISO_DATE_RE.test(value)) return null;
  const hasZone = /(Z|[+-]\d{2}:?\d{2})$/.test(value);
  const parsed = new Date(hasZone ? value : `${value.replace(' ', 'T')}Z`);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

/**
 * Render an entry as the exact byte sequence that gets hashed.
 *
 * Exposed so an auditor can reproduce a digest by hand and confirm the app is
 * not hashing something other than what it displays.
 */
export function canonicalizeEntry(entry: ChainableEntry): string {
  const pairs: string[] = [];
  for (const field of HASHED_FIELDS) {
    const value = normalizeValue((entry as Record<string, unknown>)[field]);
    pairs.push(`${field}${FIELD_VALUE_SEPARATOR}${value}`);
  }
  return pairs.join(FIELD_SEPARATOR);
}

/** Compute the digest an entry must carry given its predecessor's digest. */
export function computeEntryHash(
  entry: ChainableEntry,
  previousHash: string | null,
): string {
  return createHash(HASH_ALGORITHM)
    .update(previousHash ?? GENESIS_HASH)
    .update(CHAIN_SEPARATOR)
    .update(canonicalizeEntry(entry))
    .digest('hex');
}

export type ChainBreak = {
  sequenceNumber: number;
  /**
   * `HASH_MISMATCH`   — the entry's contents no longer match its stored digest
   *                     (the row was edited in place).
   * `BROKEN_LINK`     — the entry's previousHash does not match the digest of
   *                     the entry before it (a row was inserted or replaced).
   * `SEQUENCE_GAP`    — a sequence number is missing (a row was deleted).
   * `DUPLICATE_SEQUENCE` — two entries claim the same number.
   */
  kind: 'HASH_MISMATCH' | 'BROKEN_LINK' | 'SEQUENCE_GAP' | 'DUPLICATE_SEQUENCE';
  detail: string;
};

export type ChainVerification = {
  ok: boolean;
  entriesChecked: number;
  breaks: ChainBreak[];
  /** Digest of the last entry — the value a new entry must chain onto. */
  headHash: string | null;
};

/**
 * Walk a notary's journal and confirm it has not been altered.
 *
 * `entries` may arrive in any order; they are sorted by sequence number here.
 * `expectedStart` is the notary's configured first journal number, so a journal
 * that begins at 1001 is not reported as having 1000 missing entries.
 */
export function verifyChain(
  entries: readonly SealedEntry[],
  expectedStart?: number,
): ChainVerification {
  const sorted = [...entries].sort((a, b) => a.sequenceNumber - b.sequenceNumber);
  const breaks: ChainBreak[] = [];

  let previousHash: string | null = null;
  let previousSequence: number | null = null;

  for (const entry of sorted) {
    if (previousSequence !== null) {
      if (entry.sequenceNumber === previousSequence) {
        breaks.push({
          sequenceNumber: entry.sequenceNumber,
          kind: 'DUPLICATE_SEQUENCE',
          detail: `Two entries share journal number ${entry.sequenceNumber}.`,
        });
      } else if (entry.sequenceNumber !== previousSequence + 1) {
        const missing = entry.sequenceNumber - previousSequence - 1;
        breaks.push({
          sequenceNumber: entry.sequenceNumber,
          kind: 'SEQUENCE_GAP',
          detail:
            `${missing} journal ${missing === 1 ? 'number is' : 'numbers are'} ` +
            `missing between ${previousSequence} and ${entry.sequenceNumber}.`,
        });
      }
    } else if (expectedStart !== undefined && entry.sequenceNumber !== expectedStart) {
      const missing = entry.sequenceNumber - expectedStart;
      if (missing > 0) {
        breaks.push({
          sequenceNumber: entry.sequenceNumber,
          kind: 'SEQUENCE_GAP',
          detail:
            `Journal starts at ${entry.sequenceNumber} but is configured to ` +
            `begin at ${expectedStart}.`,
        });
      }
    }

    const linkedTo = entry.previousHash;
    const expectedLink = previousSequence === null ? null : previousHash;
    if (previousSequence !== null && linkedTo !== expectedLink) {
      breaks.push({
        sequenceNumber: entry.sequenceNumber,
        kind: 'BROKEN_LINK',
        detail:
          `Entry ${entry.sequenceNumber} does not link to entry ${previousSequence}.`,
      });
    }

    // Recompute against the link the entry actually claims, so a single edited
    // row is reported as one HASH_MISMATCH rather than cascading down the rest
    // of the journal.
    const recomputed = computeEntryHash(entry, linkedTo);
    if (recomputed !== entry.entryHash) {
      breaks.push({
        sequenceNumber: entry.sequenceNumber,
        kind: 'HASH_MISMATCH',
        detail:
          `Entry ${entry.sequenceNumber} has been modified since it was sealed.`,
      });
    }

    previousHash = entry.entryHash;
    previousSequence = entry.sequenceNumber;
  }

  return {
    ok: breaks.length === 0,
    entriesChecked: sorted.length,
    breaks,
    headHash: previousHash,
  };
}

/** Short, human-readable digest fingerprint for display in the UI. */
export function shortHash(hash: string | null | undefined): string {
  if (!hash) return '—';
  return `${hash.slice(0, 8)}…${hash.slice(-4)}`;
}

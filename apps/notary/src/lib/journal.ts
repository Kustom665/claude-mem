import 'server-only';

import { Prisma } from '@/generated/prisma';
import type { JournalEntry } from '@/generated/prisma';
import { prisma } from './db';
import { computeEntryHash, verifyChain, type SealedEntry } from './journal-chain';
import type { JournalEntryInput } from './validation';

/**
 * Journal writes.
 *
 * The only way an entry enters the journal is `appendJournalEntry`. There is no
 * update or delete path anywhere in the application — corrections are appended
 * as amendments that reference the entry they fix.
 */

/** Fields the chain covers, plus the identity of the row. */
const ENTRY_SELECT = {
  id: true,
  sequenceNumber: true,
  performedAt: true,
  actType: true,
  documentType: true,
  documentDate: true,
  documentDescription: true,
  numberOfSignatures: true,
  signerName: true,
  signerAddressLine1: true,
  signerCity: true,
  signerState: true,
  signerPostalCode: true,
  signerPhone: true,
  signerEmail: true,
  identityMethod: true,
  idType: true,
  idIssuer: true,
  idNumberLast4: true,
  idIssuedOn: true,
  idExpiresOn: true,
  credibleWitnessName: true,
  credibleWitnessAddress: true,
  secondCredibleWitnessName: true,
  feeChargedCents: true,
  travelFeeCents: true,
  notarizedRemotely: true,
  ronPlatform: true,
  thumbprintTaken: true,
  witnessNames: true,
  locationCity: true,
  locationState: true,
  notes: true,
  signingId: true,
  sealedAt: true,
  amendsEntryId: true,
  amendmentReason: true,
  previousHash: true,
  entryHash: true,
} satisfies Prisma.JournalEntrySelect;

export type AppendResult =
  | { ok: true; entry: JournalEntry }
  | { ok: false; error: string };

const MAX_APPEND_ATTEMPTS = 5;

/**
 * Append a sealed entry to a notary's journal.
 *
 * Sequence number and previous-hash are read inside the transaction so two
 * concurrent writes cannot land on the same number. If they race anyway, the
 * `@@unique([userId, sequenceNumber])` constraint rejects the loser and we
 * retry — which is the correct outcome, because the second entry genuinely
 * belongs after the first, not beside it.
 */
export async function appendJournalEntry(
  userId: string,
  input: JournalEntryInput,
): Promise<AppendResult> {
  for (let attempt = 0; attempt < MAX_APPEND_ATTEMPTS; attempt += 1) {
    try {
      const entry = await prisma.$transaction(async (tx) => {
        const user = await tx.user.findUniqueOrThrow({
          where: { id: userId },
          select: { journalStartNumber: true },
        });

        const previous = await tx.journalEntry.findFirst({
          where: { userId },
          orderBy: { sequenceNumber: 'desc' },
          select: { sequenceNumber: true, entryHash: true },
        });

        const sequenceNumber = previous
          ? previous.sequenceNumber + 1
          : Math.max(1, user.journalStartNumber);
        const previousHash = previous?.entryHash ?? null;

        // sealedAt is generated here rather than relying on the column default,
        // because the value must be identical in the row and in the digest.
        const sealedAt = new Date();

        // Only link to a signing that belongs to this notary — a forged id in
        // the form must not attach an entry to someone else's job.
        const signingId = await resolveOwnedSigningId(tx, userId, input.signingId);
        const amendsEntryId = await resolveOwnedEntryId(tx, userId, input.amendsEntryId);

        const payload = {
          sequenceNumber,
          performedAt: input.performedAt,
          actType: input.actType,
          documentType: input.documentType,
          documentDate: input.documentDate,
          documentDescription: input.documentDescription,
          numberOfSignatures: input.numberOfSignatures,
          signerName: input.signerName,
          signerAddressLine1: input.signerAddressLine1,
          signerCity: input.signerCity,
          signerState: input.signerState,
          signerPostalCode: input.signerPostalCode,
          signerPhone: input.signerPhone,
          signerEmail: input.signerEmail,
          identityMethod: input.identityMethod,
          idType: input.idType,
          idIssuer: input.idIssuer,
          idNumberLast4: input.idNumberLast4,
          idIssuedOn: input.idIssuedOn,
          idExpiresOn: input.idExpiresOn,
          credibleWitnessName: input.credibleWitnessName,
          credibleWitnessAddress: input.credibleWitnessAddress,
          secondCredibleWitnessName: input.secondCredibleWitnessName,
          feeChargedCents: input.feeChargedCents,
          travelFeeCents: input.travelFeeCents,
          notarizedRemotely: input.notarizedRemotely,
          ronPlatform: input.ronPlatform,
          thumbprintTaken: input.thumbprintTaken,
          witnessNames: input.witnessNames,
          locationCity: input.locationCity,
          locationState: input.locationState,
          notes: input.notes,
          signingId,
          sealedAt,
          amendsEntryId,
          amendmentReason: input.amendmentReason,
        };

        const entryHash = computeEntryHash(payload, previousHash);

        return tx.journalEntry.create({
          data: { ...payload, userId, previousHash, entryHash },
        });
      });

      return { ok: true, entry };
    } catch (error) {
      if (isUniqueViolation(error) && attempt < MAX_APPEND_ATTEMPTS - 1) {
        continue;
      }
      return {
        ok: false,
        error:
          error instanceof Error
            ? error.message
            : 'Could not write the journal entry. Nothing was saved.',
      };
    }
  }

  return {
    ok: false,
    error: 'The journal is busy with another write. Try again in a moment.',
  };
}

function isUniqueViolation(error: unknown): boolean {
  return (
    error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002'
  );
}

type TxClient = Prisma.TransactionClient;

async function resolveOwnedSigningId(
  tx: TxClient,
  userId: string,
  signingId: string | null,
): Promise<string | null> {
  if (!signingId) return null;
  const signing = await tx.signing.findFirst({
    where: { id: signingId, userId },
    select: { id: true },
  });
  return signing?.id ?? null;
}

async function resolveOwnedEntryId(
  tx: TxClient,
  userId: string,
  entryId: string | null,
): Promise<string | null> {
  if (!entryId) return null;
  const entry = await tx.journalEntry.findFirst({
    where: { id: entryId, userId },
    select: { id: true },
  });
  return entry?.id ?? null;
}

/**
 * Verify a notary's entire journal.
 *
 * Reads only the hashed fields, so the check is over exactly the data the
 * digest covers.
 */
export async function verifyJournal(userId: string) {
  const [user, entries] = await Promise.all([
    prisma.user.findUniqueOrThrow({
      where: { id: userId },
      select: { journalStartNumber: true },
    }),
    prisma.journalEntry.findMany({
      where: { userId },
      orderBy: { sequenceNumber: 'asc' },
      select: ENTRY_SELECT,
    }),
  ]);

  return verifyChain(entries as unknown as SealedEntry[], user.journalStartNumber);
}

/**
 * The digest of the most recent entry.
 *
 * Worth publishing somewhere outside the system — emailed to yourself, or
 * committed to a notebook — because an attacker who can rewrite the database
 * can also recompute every digest in it. An externally held head hash is what
 * turns "internally consistent" into "provably unchanged since that date".
 */
export async function journalHeadHash(userId: string): Promise<string | null> {
  const latest = await prisma.journalEntry.findFirst({
    where: { userId },
    orderBy: { sequenceNumber: 'desc' },
    select: { entryHash: true },
  });
  return latest?.entryHash ?? null;
}

export { ENTRY_SELECT };

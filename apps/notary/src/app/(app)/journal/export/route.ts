import { requireUser } from '@/lib/auth';
import { prisma } from '@/lib/db';
import type { Prisma } from '@/generated/prisma';
import { csvResponse, toCsv } from '@/lib/csv';
import { ACT_TYPE_LABELS, IDENTITY_METHOD_LABELS, labelFor } from '@/lib/domain';

/**
 * Journal export.
 *
 * Includes the digest columns as well as the record fields, so a recipient can
 * independently verify the chain from the CSV alone rather than taking the
 * app's word for it.
 */
export async function GET(request: Request): Promise<Response> {
  const user = await requireUser();
  const url = new URL(request.url);

  const where: Prisma.JournalEntryWhereInput = { userId: user.id };

  const query = url.searchParams.get('q')?.trim();
  if (query) {
    where.OR = [
      { signerName: { contains: query } },
      { documentType: { contains: query } },
      { documentDescription: { contains: query } },
      { notes: { contains: query } },
    ];
  }

  const act = url.searchParams.get('act');
  if (act) where.actType = act;

  const from = url.searchParams.get('from');
  const to = url.searchParams.get('to');
  if (from || to) {
    where.performedAt = {};
    if (from) where.performedAt.gte = new Date(from);
    if (to) {
      const end = new Date(to);
      end.setHours(23, 59, 59, 999);
      where.performedAt.lte = end;
    }
  }

  const entries = await prisma.journalEntry.findMany({
    where,
    orderBy: { sequenceNumber: 'asc' },
  });

  const headers = [
    'Entry number',
    'Performed at',
    'Act type',
    'Document type',
    'Document date',
    'Description',
    'Signatures',
    'Signer name',
    'Signer address',
    'Signer city',
    'Signer state',
    'Signer ZIP',
    'Signer phone',
    'Identification method',
    'ID type',
    'ID issuer',
    'ID last four',
    'ID expires',
    'Credible witness',
    'Notarial fee (USD)',
    'Travel fee (USD)',
    'Remote',
    'RON platform',
    'Thumbprint',
    'Witnesses',
    'City of act',
    'State of act',
    'Notes',
    'Amends entry',
    'Amendment reason',
    'Sealed at',
    'Previous digest',
    'Entry digest',
  ];

  const sequenceById = new Map(entries.map((entry) => [entry.id, entry.sequenceNumber]));

  const rows = entries.map((entry) => [
    entry.sequenceNumber,
    entry.performedAt.toISOString(),
    labelFor(ACT_TYPE_LABELS, entry.actType),
    entry.documentType,
    entry.documentDate?.toISOString().slice(0, 10) ?? '',
    entry.documentDescription ?? '',
    entry.numberOfSignatures,
    entry.signerName,
    entry.signerAddressLine1 ?? '',
    entry.signerCity ?? '',
    entry.signerState ?? '',
    entry.signerPostalCode ?? '',
    entry.signerPhone ?? '',
    labelFor(IDENTITY_METHOD_LABELS, entry.identityMethod),
    entry.idType ?? '',
    entry.idIssuer ?? '',
    entry.idNumberLast4 ?? '',
    entry.idExpiresOn?.toISOString().slice(0, 10) ?? '',
    entry.credibleWitnessName ?? '',
    (entry.feeChargedCents / 100).toFixed(2),
    (entry.travelFeeCents / 100).toFixed(2),
    entry.notarizedRemotely ? 'Yes' : 'No',
    entry.ronPlatform ?? '',
    entry.thumbprintTaken ? 'Yes' : 'No',
    entry.witnessNames ?? '',
    entry.locationCity ?? '',
    entry.locationState ?? '',
    entry.notes ?? '',
    entry.amendsEntryId ? (sequenceById.get(entry.amendsEntryId) ?? entry.amendsEntryId) : '',
    entry.amendmentReason ?? '',
    entry.sealedAt.toISOString(),
    entry.previousHash ?? 'GENESIS',
    entry.entryHash,
  ]);

  const stamp = new Date().toISOString().slice(0, 10);
  return csvResponse(`notary-journal-${stamp}.csv`, toCsv(headers, rows));
}

import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { requireUser } from '@/lib/auth';
import { prisma } from '@/lib/db';
import {
  feeReferenceFor,
  journalFieldRulesFor,
  requiresFeeDisclosure,
} from '@/lib/compliance';
import { toDateTimeInputValue } from '@/lib/dates';
import { OPEN_SIGNING_STATUSES } from '@/lib/domain';
import { PageHeader } from '@/components/ui';
import { JournalEntryForm, type JournalFormRules } from '../../new/form';

export const metadata: Metadata = { title: 'Amend journal entry' };

const THUMBPRINT_TRIGGERS = [
  'power of attorney',
  'deed of trust',
  'quitclaim deed',
  'quit claim deed',
  'grant deed',
  'warranty deed',
  'interspousal transfer',
  'security deed',
  'mortgage',
  'deed',
];

export default async function AmendJournalEntryPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const user = await requireUser();
  const { id } = await params;

  const original = await prisma.journalEntry.findFirst({
    where: { id, userId: user.id },
    select: {
      id: true,
      sequenceNumber: true,
      signerName: true,
      documentType: true,
      performedAt: true,
      locationState: true,
      signingId: true,
    },
  });

  if (!original) notFound();

  const signings = await prisma.signing.findMany({
    where: { userId: user.id, status: { in: [...OPEN_SIGNING_STATUSES, 'COMPLETED'] } },
    orderBy: { scheduledAt: 'desc' },
    take: 50,
    select: { id: true, title: true, scheduledAt: true },
  });

  const fieldRules = journalFieldRulesFor(user.commissionState);
  const feeReference = feeReferenceFor(user.commissionState);

  const rules: JournalFormRules = {
    commissionState: user.commissionState,
    prohibitsBiometrics: fieldRules.prohibitsBiometrics,
    publicInspectionRight: fieldRules.publicInspectionRight,
    thumbprintTriggers: THUMBPRINT_TRIGGERS,
    actMaxCents: feeReference?.acknowledgmentMaxCents ?? null,
    ronMaxCents: feeReference?.ronMaxCents ?? null,
    ronIsSurcharge: feeReference?.ronIsSurcharge ?? false,
    requiresFeeDisclosure: requiresFeeDisclosure(user.commissionState),
    feeNote: feeReference?.note ?? null,
  };

  return (
    <>
      <PageHeader
        title={`Amend entry #${original.sequenceNumber}`}
        description="Sealed entries are never edited. This adds a corrected entry that references the original, leaving both in the record."
      />
      <div className="max-w-4xl">
        <JournalEntryForm
          rules={rules}
          signings={signings.map((signing) => ({
            id: signing.id,
            label: `${signing.title} — ${signing.scheduledAt.toLocaleDateString('en-US')}`,
          }))}
          defaults={{
            // The act itself happened when it happened — carry the original
            // timestamp forward rather than stamping the correction's date.
            performedAt: toDateTimeInputValue(original.performedAt, user.timezone),
            locationState: original.locationState ?? user.commissionState,
            signingId: original.signingId ?? undefined,
            documentType: original.documentType,
            signerName: original.signerName,
          }}
          amending={{
            entryId: original.id,
            sequenceNumber: original.sequenceNumber,
            signerName: original.signerName,
          }}
        />
      </div>
    </>
  );
}

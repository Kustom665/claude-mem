import type { Metadata } from 'next';
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
import { JournalEntryForm, type JournalFormRules } from './form';

export const metadata: Metadata = { title: 'Record a notarial act' };

/**
 * Lowercase phrases that make a document real-property-related. Shared with the
 * client so the browser preview and the server check agree.
 */
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

export default async function NewJournalEntryPage({
  searchParams,
}: {
  searchParams: Promise<{ signing?: string }>;
}) {
  const user = await requireUser();
  const params = await searchParams;

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
        title="Record a notarial act"
        description="One entry per act. Three documents signed at one appointment are three entries, each with its own fee."
      />
      <div className="max-w-4xl">
        <JournalEntryForm
          rules={rules}
          signings={signings.map((signing) => ({
            id: signing.id,
            label: `${signing.title} — ${signing.scheduledAt.toLocaleDateString('en-US')}`,
          }))}
          defaults={{
            performedAt: toDateTimeInputValue(new Date(), user.timezone),
            locationState: user.commissionState,
            signingId: params.signing,
          }}
        />
      </div>
    </>
  );
}

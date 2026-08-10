import type { Metadata } from 'next';
import { requireUser } from '@/lib/auth';
import { prisma } from '@/lib/db';
import { journalFieldRulesFor, journalRuleFor, REFERENCE_CAPTURED_ON } from '@/lib/compliance';
import { toDateInputValue } from '@/lib/dates';
import { Alert, PageHeader } from '@/components/ui';
import { SettingsTabs } from '../tabs';
import { CommissionForm } from './commission-form';

export const metadata: Metadata = { title: 'Commission & compliance' };

export default async function CommissionSettingsPage() {
  const user = await requireUser();
  const entryCount = await prisma.journalEntry.count({ where: { userId: user.id } });

  const journalRule = journalRuleFor(user.commissionState);
  const fieldRules = journalFieldRulesFor(user.commissionState);

  return (
    <>
      <PageHeader
        title="Commission & compliance"
        description="Drives the expiry warnings, the fee caps and the journal rules this app enforces."
      />
      <SettingsTabs active="commission" />

      <div className="max-w-4xl space-y-5">
        <Alert
          tone={journalRule.requirement === 'REQUIRED' ? 'info' : 'neutral'}
          title={`Journal rules — ${user.commissionState ?? 'your state'}`}
        >
          <p>{journalRule.note}</p>
          {fieldRules.note ? <p className="mt-2">{fieldRules.note}</p> : null}
          <p className="mt-2 text-xs">
            Reference data captured {REFERENCE_CAPTURED_ON}.
            {journalRule.source ? (
              <>
                {' '}
                <a href={journalRule.source} target="_blank" rel="noreferrer" className="underline">
                  Official source
                </a>
              </>
            ) : null}
          </p>
        </Alert>

        {journalRule.electronicJournalPermitted === false ? (
          <Alert tone="warning" title="Your state may require a tangible journal">
            {user.commissionState} does not clearly permit an electronic journal as the journal of
            record. Keep your bound paper journal as the official record and treat this app as your
            business copy until you have confirmed otherwise with your commissioning authority.
          </Alert>
        ) : null}

        <CommissionForm
          entryCount={entryCount}
          values={{
            commissionNumber: user.commissionNumber,
            commissionState: user.commissionState ?? 'PA',
            commissionCounty: user.commissionCounty,
            commissionIssuedOn: toDateInputValue(user.commissionIssuedOn, user.timezone),
            commissionExpiresOn: toDateInputValue(user.commissionExpiresOn, user.timezone),
            sealDescription: user.sealDescription,
            isSigningAgent: user.isSigningAgent,
            backgroundCheckExpiresOn: toDateInputValue(
              user.backgroundCheckExpiresOn,
              user.timezone,
            ),
            eoPolicyNumber: user.eoPolicyNumber,
            eoCoverageCents: user.eoCoverageCents,
            eoExpiresOn: toDateInputValue(user.eoExpiresOn, user.timezone),
            bondNumber: user.bondNumber,
            bondAmountCents: user.bondAmountCents,
            bondExpiresOn: toDateInputValue(user.bondExpiresOn, user.timezone),
            journalStartNumber: user.journalStartNumber,
          }}
        />
      </div>
    </>
  );
}

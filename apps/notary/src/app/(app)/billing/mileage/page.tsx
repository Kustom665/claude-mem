import type { Metadata } from 'next';
import { requireUser } from '@/lib/auth';
import { prisma } from '@/lib/db';
import { MILEAGE_RATE_NOTE, MILEAGE_RATE_SOURCE, irsMileageRateCents } from '@/lib/compliance';
import { formatCents } from '@/lib/money';
import { formatDate, startOfYear } from '@/lib/dates';
import { summarizeMileage } from '@/lib/tax';
import {
  Alert,
  Card,
  CardHeader,
  EmptyState,
  LinkButton,
  PageHeader,
  StatTile,
  Table,
  Td,
  Th,
} from '@/components/ui';
import { BillingTabs } from '../tabs';
import { MileageForm } from './mileage-form';
import { DeleteMileageButton } from './delete-button';

export const metadata: Metadata = { title: 'Mileage' };

export default async function MileagePage() {
  const user = await requireUser();
  const yearStart = startOfYear(new Date());

  const [entries, yearEntries, signings] = await Promise.all([
    prisma.mileageEntry.findMany({
      where: { userId: user.id },
      orderBy: { date: 'desc' },
      take: 200,
      include: { signing: { select: { id: true, title: true } } },
    }),
    prisma.mileageEntry.findMany({
      where: { userId: user.id, date: { gte: yearStart } },
      select: { date: true, miles: true, ratePerMileCents: true },
    }),
    prisma.signing.findMany({
      where: { userId: user.id },
      orderBy: { scheduledAt: 'desc' },
      take: 50,
      select: { id: true, title: true, scheduledAt: true },
    }),
  ]);

  const summary = summarizeMileage(yearEntries);

  return (
    <>
      <PageHeader
        title="Mileage"
        description="Deductible business travel. Signings with mileage log themselves here automatically."
        actions={<LinkButton href="/reports">Tax report</LinkButton>}
      />

      <BillingTabs active="mileage" />

      <section className="mb-5 grid gap-3 sm:grid-cols-3">
        <StatTile
          label="Miles this year"
          value={summary.totalMiles.toLocaleString('en-US')}
        />
        <StatTile
          label="Deduction this year"
          value={formatCents(summary.deductionCents)}
          tone="success"
        />
        <StatTile
          label="Current IRS rate"
          value={`${(irsMileageRateCents() / 100).toFixed(3).replace(/0$/, '')}/mi`}
          sublabel="Business standard rate"
        />
      </section>

      {summary.byRate.length > 1 ? (
        <Alert tone="info" title="Two IRS rates apply this year" className="mb-5">
          {MILEAGE_RATE_NOTE} Each trip is valued at the rate in force on the day it was driven, not
          today&rsquo;s rate.
          <ul className="mt-2 space-y-0.5">
            {summary.byRate.map((bucket) => (
              <li key={bucket.ratePerMileCents} className="tabular text-xs">
                {bucket.miles.toLocaleString('en-US')} mi at{' '}
                {(bucket.ratePerMileCents / 100).toFixed(3).replace(/0$/, '')}/mi ={' '}
                {formatCents(bucket.deductionCents)}
              </li>
            ))}
          </ul>
          <a
            href={MILEAGE_RATE_SOURCE}
            target="_blank"
            rel="noreferrer"
            className="mt-2 inline-block text-xs underline"
          >
            IRS source
          </a>
        </Alert>
      ) : null}

      <div className="grid gap-5 lg:grid-cols-3">
        <div className="lg:col-span-2">
          <Card>
            <CardHeader title="Trip log" description={`${entries.length} most recent trips`} />
            {entries.length === 0 ? (
              <EmptyState
                title="No mileage logged"
                description="Add a trip, or put round-trip miles on a signing and it will appear here."
              />
            ) : (
              <Table>
                <thead>
                  <tr>
                    <Th>Date</Th>
                    <Th>Purpose</Th>
                    <Th align="right">Miles</Th>
                    <Th align="right">Rate</Th>
                    <Th align="right">Deduction</Th>
                    <Th />
                  </tr>
                </thead>
                <tbody>
                  {entries.map((entry) => (
                    <tr key={entry.id}>
                      <Td className="whitespace-nowrap text-[var(--text-muted)]">
                        {formatDate(entry.date, user.timezone)}
                      </Td>
                      <Td>
                        {entry.purpose}
                        {entry.fromAddress || entry.toAddress ? (
                          <span className="block text-xs text-[var(--text-subtle)]">
                            {[entry.fromAddress, entry.toAddress].filter(Boolean).join(' → ')}
                          </span>
                        ) : null}
                      </Td>
                      <Td align="right" className="tabular">
                        {entry.miles}
                      </Td>
                      <Td align="right" className="tabular text-[var(--text-muted)]">
                        {(entry.ratePerMileCents / 100).toFixed(3).replace(/0$/, '')}
                      </Td>
                      <Td align="right" className="tabular">
                        {formatCents(Math.round(entry.miles * entry.ratePerMileCents))}
                      </Td>
                      <Td align="right">
                        {entry.signingId ? (
                          <span className="text-xs text-[var(--text-subtle)]">from signing</span>
                        ) : (
                          <DeleteMileageButton entryId={entry.id} />
                        )}
                      </Td>
                    </tr>
                  ))}
                </tbody>
              </Table>
            )}
          </Card>
        </div>

        <div>
          <Card>
            <CardHeader title="Log a trip" />
            <div className="px-5 py-4">
              <MileageForm
                defaultRateCents={Math.round(irsMileageRateCents())}
                signings={signings.map((signing) => ({
                  id: signing.id,
                  label: `${signing.title} — ${signing.scheduledAt.toLocaleDateString('en-US')}`,
                }))}
              />
            </div>
          </Card>
        </div>
      </div>
    </>
  );
}

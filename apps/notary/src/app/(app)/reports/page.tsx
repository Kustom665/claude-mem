import type { Metadata } from 'next';
import Link from 'next/link';
import { requireUser } from '@/lib/auth';
import { prisma } from '@/lib/db';
import { MILEAGE_RATE_NOTE, MILEAGE_RATE_SOURCE } from '@/lib/compliance';
import { yearBoundsInZone, yearInZone } from '@/lib/dates';
import { ACT_TYPE_LABELS, labelFor } from '@/lib/domain';
import { formatCents, parseMoneyToCents } from '@/lib/money';
import {
  SE_NET_EARNINGS_FACTOR,
  SE_TAX_RATE,
  TAX_DISCLAIMER,
  splitIncome,
  summarizeMileage,
  summarizeTax,
} from '@/lib/tax';
import {
  Alert,
  Badge,
  Button,
  Card,
  CardBody,
  CardHeader,
  cx,
  EmptyState,
  Field,
  Input,
  PageHeader,
  StatTile,
  Table,
  Td,
  Th,
} from '@/components/ui';

export const metadata: Metadata = { title: 'Reports' };

function parseYear(raw: string | undefined, fallback: number): number {
  const year = Number(raw);
  return Number.isInteger(year) && year >= 2000 && year <= fallback + 1 ? year : fallback;
}

export default async function ReportsPage({
  searchParams,
}: {
  searchParams: Promise<{ year?: string; expenses?: string }>;
}) {
  const user = await requireUser();
  const params = await searchParams;

  const currentYear = yearInZone(new Date(), user.timezone);
  const year = parseYear(params.year, currentYear);
  const { start, end } = yearBoundsInZone(year, user.timezone);

  // Other deductible expenses (insurance, supplies, phone) are not tracked here;
  // the notary can type a total to see how it moves the estimate.
  const expensesInput = (params.expenses ?? '').trim();
  const parsedExpenses = expensesInput === '' ? 0 : parseMoneyToCents(expensesInput);
  const expensesInvalid = parsedExpenses === null || parsedExpenses < 0;
  const otherExpenseCents = expensesInvalid ? 0 : (parsedExpenses ?? 0);

  const [journal, signings, mileage] = await Promise.all([
    prisma.journalEntry.findMany({
      where: { userId: user.id, performedAt: { gte: start, lt: end } },
      select: { actType: true, feeChargedCents: true, travelFeeCents: true },
    }),
    prisma.signing.findMany({
      where: { userId: user.id, status: 'COMPLETED', scheduledAt: { gte: start, lt: end } },
      select: {
        signingFeeCents: true,
        travelFeeCents: true,
        printFeeCents: true,
        additionalFeeCents: true,
      },
    }),
    prisma.mileageEntry.findMany({
      where: { userId: user.id, date: { gte: start, lt: end } },
      select: { date: true, miles: true, ratePerMileCents: true },
    }),
  ]);

  const income = splitIncome(journal, signings);
  const mileageSummary = summarizeMileage(mileage);
  const summary = summarizeTax(income, mileageSummary, otherExpenseCents);

  const actCounts = new Map<string, number>();
  for (const entry of journal) {
    actCounts.set(entry.actType, (actCounts.get(entry.actType) ?? 0) + 1);
  }
  const actRows = [...actCounts.entries()].sort((a, b) => b[1] - a[1]);

  const years = [currentYear, currentYear - 1, currentYear - 2, currentYear - 3];
  const hasData = journal.length > 0 || signings.length > 0 || mileage.length > 0;

  return (
    <>
      <PageHeader
        title="Reports"
        description="Your year-end tax position, with the self-employment exemption for notarial fees applied."
        actions={
          <div className="no-print flex flex-wrap gap-2">
            {years.map((value) => (
              <Link
                key={value}
                href={`/reports?year=${value}`}
                aria-current={value === year ? 'page' : undefined}
                className={cx(
                  'rounded-lg px-3 py-1.5 text-sm font-medium',
                  value === year
                    ? 'bg-seal-600 text-white'
                    : 'border border-[var(--border-strong)] text-[var(--text-muted)] hover:bg-[var(--surface-sunken)]',
                )}
              >
                {value}
              </Link>
            ))}
          </div>
        }
      />

      <div className="space-y-5">
        <Alert tone="warning" title="A bookkeeping aid, not tax advice">
          {TAX_DISCLAIMER}
        </Alert>

        {!hasData ? (
          <Card>
            <EmptyState
              title={`Nothing recorded for ${year}`}
              description="Fees come from your journal and completed signings, and mileage from your mileage log. Record some work and this report fills in."
            />
          </Card>
        ) : (
          <>
            <section className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              <StatTile label="Total income" value={formatCents(income.totalCents)} sublabel={`${year}, before deductions`} />
              <StatTile
                label="Notarial fees"
                value={formatCents(income.notarialFeeCents)}
                sublabel="Exempt from self-employment tax"
                tone="success"
              />
              <StatTile
                label="Estimated SE tax"
                value={formatCents(summary.estimatedSeTaxCents)}
                sublabel={`On ${formatCents(summary.seTaxableBaseCents)} of net earnings`}
                tone="warning"
              />
              <StatTile
                label="Saved by separating them"
                value={formatCents(summary.estimatedSavingsCents)}
                sublabel="Versus taxing every dollar"
                tone="success"
              />
            </section>

            <div className="grid gap-5 lg:grid-cols-2">
              <Card>
                <CardHeader title="Schedule C" description="Profit or loss from business" />
                <Table>
                  <tbody>
                    <Row label="Fees for notarial acts" value={income.notarialFeeCents} note="From your journal" />
                    <Row
                      label="Travel, printing and signing-service fees"
                      value={income.nonNotarialFeeCents}
                      note="Journal travel fees and completed signings"
                    />
                    <Row label="Gross receipts" value={income.totalCents} strong />
                    <Row
                      label="Car and truck expenses (mileage)"
                      value={-mileageSummary.deductionCents}
                      note={`${mileageSummary.totalMiles.toLocaleString('en-US')} business miles`}
                    />
                    <Row
                      label="Other expenses"
                      value={-otherExpenseCents}
                      note={otherExpenseCents > 0 ? 'The figure you entered below' : 'None entered'}
                    />
                    <Row label="Net profit" value={summary.netProfitCents} strong />
                  </tbody>
                </Table>
              </Card>

              <Card>
                <CardHeader title="Schedule SE" description="Self-employment tax" />
                <Table>
                  <tbody>
                    <Row label="Net profit from Schedule C" value={summary.netProfitCents} />
                    <Row
                      label="Less: notarial fees (exempt)"
                      value={-income.notarialFeeCents}
                      note="Reported as income, not subject to SE tax"
                    />
                    <Row label="Net earnings subject to SE tax" value={summary.seTaxableBaseCents} strong />
                    <Row
                      label="Estimated self-employment tax"
                      value={summary.estimatedSeTaxCents}
                      note={`${(SE_NET_EARNINGS_FACTOR * 100).toFixed(2)}% × ${(SE_TAX_RATE * 100).toFixed(1)}%`}
                      strong
                    />
                    <Row
                      label="Without separating notarial fees"
                      value={summary.seTaxWithoutExemptionCents}
                      note="If every dollar were taxed"
                    />
                    <Row label="Estimated saving" value={summary.estimatedSavingsCents} strong />
                  </tbody>
                </Table>
              </Card>
            </div>

            <div className="grid gap-5 lg:grid-cols-2">
              <Card>
                <CardHeader
                  title="Mileage"
                  description="Each trip valued at the rate in force on the day it was driven."
                />
                {mileageSummary.byRate.length === 0 ? (
                  <EmptyState title="No mileage logged" description="Log trips from the Billing page." />
                ) : (
                  <Table>
                    <thead>
                      <tr>
                        <Th>Rate</Th>
                        <Th align="right">Miles</Th>
                        <Th align="right">Deduction</Th>
                      </tr>
                    </thead>
                    <tbody>
                      {mileageSummary.byRate.map((bucket) => (
                        <tr key={bucket.ratePerMileCents}>
                          <Td className="tabular">{bucket.ratePerMileCents}¢ per mile</Td>
                          <Td align="right" className="tabular">
                            {bucket.miles.toLocaleString('en-US')}
                          </Td>
                          <Td align="right" className="tabular">
                            {formatCents(bucket.deductionCents)}
                          </Td>
                        </tr>
                      ))}
                      <tr>
                        <Td className="font-semibold">Total</Td>
                        <Td align="right" className="tabular font-semibold">
                          {mileageSummary.totalMiles.toLocaleString('en-US')}
                        </Td>
                        <Td align="right" className="tabular font-semibold">
                          {formatCents(mileageSummary.deductionCents)}
                        </Td>
                      </tr>
                    </tbody>
                  </Table>
                )}
                <CardBody>
                  <p className="text-xs leading-relaxed text-[var(--text-subtle)]">
                    {MILEAGE_RATE_NOTE}{' '}
                    <a
                      href={MILEAGE_RATE_SOURCE}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-seal-600 hover:underline"
                    >
                      IRS source ↗
                    </a>
                  </p>
                </CardBody>
              </Card>

              <Card>
                <CardHeader
                  title="Notarial acts"
                  description={`${journal.length} ${journal.length === 1 ? 'act' : 'acts'} recorded in ${year}`}
                />
                {actRows.length === 0 ? (
                  <EmptyState title="No acts recorded" />
                ) : (
                  <Table>
                    <thead>
                      <tr>
                        <Th>Act</Th>
                        <Th align="right">Count</Th>
                      </tr>
                    </thead>
                    <tbody>
                      {actRows.map(([actType, count]) => (
                        <tr key={actType}>
                          <Td>{labelFor(ACT_TYPE_LABELS, actType)}</Td>
                          <Td align="right" className="tabular">
                            {count}
                          </Td>
                        </tr>
                      ))}
                    </tbody>
                  </Table>
                )}
              </Card>
            </div>
          </>
        )}

        <Card className="no-print">
          <CardHeader
            title="Other business expenses"
            description="E&O insurance, supplies, phone, training and similar. Enter a total to see how it changes the estimate; nothing is saved."
          />
          <form method="get" action="/reports">
            <CardBody className="flex flex-wrap items-end gap-3">
              <input type="hidden" name="year" value={year} />
              <Field
                label="Total for the year"
                htmlFor="expenses"
                error={expensesInvalid ? 'Enter a valid dollar amount.' : undefined}
                className="w-48"
              >
                <Input
                  id="expenses"
                  name="expenses"
                  inputMode="decimal"
                  placeholder="1,250.00"
                  defaultValue={expensesInput}
                />
              </Field>
              <Button type="submit" variant="secondary">
                Recalculate
              </Button>
              {otherExpenseCents > 0 ? <Badge tone="info">Including {formatCents(otherExpenseCents)}</Badge> : null}
            </CardBody>
          </form>
        </Card>
      </div>
    </>
  );
}

function Row({
  label,
  value,
  note,
  strong = false,
}: {
  label: string;
  value: number;
  note?: string;
  strong?: boolean;
}) {
  return (
    <tr>
      <Td className={cx(strong && 'font-semibold')}>
        {label}
        {note ? <span className="block text-xs font-normal text-[var(--text-subtle)]">{note}</span> : null}
      </Td>
      <Td align="right" className={cx('tabular whitespace-nowrap', strong && 'font-semibold')}>
        {value < 0 ? `(${formatCents(-value)})` : formatCents(value)}
      </Td>
    </tr>
  );
}

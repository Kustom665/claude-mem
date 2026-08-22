import type { Metadata } from 'next';
import Link from 'next/link';
import { requireUser } from '@/lib/auth';
import { prisma } from '@/lib/db';
import { verifyJournal } from '@/lib/journal';
import {
  journalFieldRulesFor,
  journalRuleFor,
  REFERENCE_CAPTURED_ON,
} from '@/lib/compliance';
import { formatCents } from '@/lib/money';
import { splitIncome, summarizeMileage } from '@/lib/tax';
import {
  addDays,
  daysUntil,
  endOfDay,
  expiryUrgency,
  formatDateTime,
  startOfDay,
  startOfMonth,
} from '@/lib/dates';
import { OPEN_SIGNING_STATUSES, SIGNING_STATUS_LABELS, labelFor } from '@/lib/domain';
import {
  Alert,
  Badge,
  Card,
  CardBody,
  CardHeader,
  EmptyState,
  LinkButton,
  PageHeader,
  StatTile,
  Table,
  Td,
  Th,
  type Tone,
} from '@/components/ui';

export const metadata: Metadata = { title: 'Dashboard' };

type CredentialAlert = {
  label: string;
  date: Date;
  days: number;
  tone: Tone;
};

export default async function DashboardPage() {
  const user = await requireUser();
  const now = new Date();
  const monthStart = startOfMonth(now);

  const [upcoming, monthJournal, monthSignings, monthMileage, journalCount, chain, unpaidTotal] =
    await Promise.all([
      prisma.signing.findMany({
        where: {
          userId: user.id,
          status: { in: [...OPEN_SIGNING_STATUSES] },
          scheduledAt: { gte: startOfDay(now), lte: endOfDay(addDays(now, 14)) },
        },
        orderBy: { scheduledAt: 'asc' },
        take: 8,
        include: { client: { select: { name: true } } },
      }),
      prisma.journalEntry.findMany({
        where: { userId: user.id, performedAt: { gte: monthStart } },
        select: { feeChargedCents: true, travelFeeCents: true },
      }),
      prisma.signing.findMany({
        where: { userId: user.id, status: 'COMPLETED', scheduledAt: { gte: monthStart } },
        select: {
          signingFeeCents: true,
          travelFeeCents: true,
          printFeeCents: true,
          additionalFeeCents: true,
        },
      }),
      prisma.mileageEntry.findMany({
        where: { userId: user.id, date: { gte: monthStart } },
        select: { date: true, miles: true, ratePerMileCents: true },
      }),
      prisma.journalEntry.count({ where: { userId: user.id } }),
      verifyJournal(user.id),
      prisma.invoice.aggregate({
        where: { userId: user.id, status: { in: ['SENT', 'PARTIAL'] } },
        _sum: { totalCents: true, amountPaidCents: true },
      }),
    ]);

  const income = splitIncome(monthJournal, monthSignings);
  const mileage = summarizeMileage(monthMileage);
  const outstanding =
    (unpaidTotal._sum.totalCents ?? 0) - (unpaidTotal._sum.amountPaidCents ?? 0);

  const alerts = credentialAlerts(user, now);
  const journalRule = journalRuleFor(user.commissionState);
  const fieldRules = journalFieldRulesFor(user.commissionState);

  return (
    <>
      <PageHeader
        title={`Good day, ${user.name.split(' ')[0]}`}
        description={
          user.commissionState
            ? `Commissioned in ${user.commissionState}. Reference data current as of ${REFERENCE_CAPTURED_ON}.`
            : 'Add your commission details in settings to switch on state-specific compliance checks.'
        }
        actions={
          <>
            <LinkButton href="/journal/new" variant="primary">
              Record a notarial act
            </LinkButton>
            <LinkButton href="/signings/new">Schedule a signing</LinkButton>
          </>
        }
      />

      {alerts.length > 0 ? (
        <div className="mb-5 space-y-2">
          {alerts.map((alert) => (
            <Alert
              key={alert.label}
              tone={alert.tone}
              title={
                alert.days < 0
                  ? `${alert.label} expired ${Math.abs(alert.days)} days ago`
                  : `${alert.label} expires in ${alert.days} days`
              }
              actions={
                <LinkButton href="/settings/commission" variant="secondary">
                  Update credentials
                </LinkButton>
              }
            >
              {alert.days < 0 && alert.label === 'Commission' ? (
                <>
                  A notarial act performed on an expired commission is void. Stop notarising until
                  your commission is renewed and recorded.
                </>
              ) : (
                <>Renewals commonly take six to ten weeks. Start now to avoid a gap in coverage.</>
              )}
            </Alert>
          ))}
        </div>
      ) : null}

      {!chain.ok ? (
        <Alert
          tone="danger"
          title="Journal integrity check failed"
          className="mb-5"
          actions={
            <LinkButton href="/journal/verify" variant="secondary">
              See what changed
            </LinkButton>
          }
        >
          {chain.breaks.length} {chain.breaks.length === 1 ? 'problem was' : 'problems were'} found
          in your journal chain. This means an entry was altered or removed outside the app.
        </Alert>
      ) : null}

      <section className="mb-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <StatTile
          label="Notarial fees this month"
          value={formatCents(income.notarialFeeCents)}
          sublabel="Exempt from self-employment tax"
          tone="success"
        />
        <StatTile
          label="Other income this month"
          value={formatCents(income.nonNotarialFeeCents)}
          sublabel="Travel, printing, signing fees"
        />
        <StatTile
          label="Mileage this month"
          value={`${mileage.totalMiles.toLocaleString('en-US')} mi`}
          sublabel={`${formatCents(mileage.deductionCents)} deductible`}
        />
        <StatTile
          label="Outstanding invoices"
          value={formatCents(outstanding)}
          tone={outstanding > 0 ? 'warning' : 'neutral'}
          sublabel={outstanding > 0 ? 'Sent but not yet paid' : 'Nothing outstanding'}
        />
      </section>

      <div className="grid gap-5 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader
            title="Next 14 days"
            description={`${upcoming.length} scheduled ${upcoming.length === 1 ? 'appointment' : 'appointments'}`}
            actions={<LinkButton href="/signings">All signings</LinkButton>}
          />
          {upcoming.length === 0 ? (
            <EmptyState
              title="Nothing on the calendar"
              description="Schedule a signing and it will show up here with its location, fee and status."
              action={<LinkButton href="/signings/new" variant="primary">Schedule a signing</LinkButton>}
            />
          ) : (
            <Table>
              <thead>
                <tr>
                  <Th>When</Th>
                  <Th>Signing</Th>
                  <Th>Client</Th>
                  <Th>Status</Th>
                  <Th align="right">Fee</Th>
                </tr>
              </thead>
              <tbody>
                {upcoming.map((signing) => {
                  const total =
                    signing.signingFeeCents +
                    signing.travelFeeCents +
                    signing.printFeeCents +
                    signing.additionalFeeCents;
                  return (
                    <tr key={signing.id}>
                      <Td className="whitespace-nowrap">
                        {formatDateTime(signing.scheduledAt, user.timezone)}
                      </Td>
                      <Td>
                        <Link
                          href={`/signings/${signing.id}`}
                          className="font-medium text-seal-600 hover:underline"
                        >
                          {signing.title}
                        </Link>
                        {signing.city ? (
                          <span className="block text-xs text-[var(--text-subtle)]">
                            {signing.city}
                            {signing.state ? `, ${signing.state}` : ''}
                          </span>
                        ) : null}
                      </Td>
                      <Td className="text-[var(--text-muted)]">{signing.client?.name ?? '—'}</Td>
                      <Td>
                        <Badge tone={statusTone(signing.status)}>
                          {labelFor(SIGNING_STATUS_LABELS, signing.status)}
                        </Badge>
                      </Td>
                      <Td align="right" className="tabular">
                        {formatCents(total)}
                      </Td>
                    </tr>
                  );
                })}
              </tbody>
            </Table>
          )}
        </Card>

        <div className="space-y-5">
          <Card>
            <CardHeader title="Journal" description={`${journalCount} sealed entries`} />
            <CardBody className="space-y-3">
              <div className="flex items-center justify-between">
                <span className="text-sm text-[var(--text-muted)]">Chain integrity</span>
                {chain.ok ? (
                  <Badge tone="success">Verified</Badge>
                ) : (
                  <Badge tone="danger">{chain.breaks.length} problems</Badge>
                )}
              </div>
              <p className="text-xs leading-relaxed text-[var(--text-subtle)]">
                {journalRule.note}
              </p>
              {fieldRules.publicInspectionRight ? (
                <p className="text-xs leading-relaxed text-[var(--text-subtle)]">
                  Anyone may ask to inspect your journal. Use the redacted inspection view so a
                  requester sees only what they are entitled to.
                </p>
              ) : null}
              <div className="flex flex-wrap gap-2 pt-1">
                <LinkButton href="/journal">Open journal</LinkButton>
                <LinkButton href="/journal/verify">Verify chain</LinkButton>
              </div>
            </CardBody>
          </Card>

          <Card>
            <CardHeader title="Year-end position" />
            <CardBody>
              <p className="text-sm text-[var(--text-muted)]">
                Notarial fees are reported as income but are exempt from self-employment tax. Keep
                them separate from travel and signing fees all year and the split is already done
                when you file.
              </p>
              <LinkButton href="/reports" className="mt-3">
                Open tax report
              </LinkButton>
            </CardBody>
          </Card>
        </div>
      </div>
    </>
  );
}

function statusTone(status: string): Tone {
  switch (status) {
    case 'COMPLETED':
      return 'success';
    case 'CONFIRMED':
      return 'info';
    case 'IN_PROGRESS':
      return 'warning';
    case 'CANCELLED':
    case 'NO_SHOW':
      return 'danger';
    default:
      return 'neutral';
  }
}

/**
 * Credential expiries worth surfacing.
 *
 * Only warns inside 90 days — a commission expiring in eight months is not news
 * and a dashboard that always shows a warning trains the user to ignore it.
 */
function credentialAlerts(
  user: {
    commissionExpiresOn: Date | null;
    eoExpiresOn: Date | null;
    backgroundCheckExpiresOn: Date | null;
    bondExpiresOn: Date | null;
  },
  now: Date,
): CredentialAlert[] {
  const candidates: Array<{ label: string; date: Date | null }> = [
    { label: 'Commission', date: user.commissionExpiresOn },
    { label: 'E&O insurance', date: user.eoExpiresOn },
    { label: 'Background check', date: user.backgroundCheckExpiresOn },
    { label: 'Surety bond', date: user.bondExpiresOn },
  ];

  const alerts: CredentialAlert[] = [];
  for (const candidate of candidates) {
    if (!candidate.date) continue;
    const urgency = expiryUrgency(candidate.date, now);
    if (urgency === null || urgency === 'ok') continue;
    const days = daysUntil(candidate.date, now);
    if (days === null) continue;
    alerts.push({
      label: candidate.label,
      date: candidate.date,
      days,
      tone: urgency === 'expired' ? 'danger' : urgency === 'critical' ? 'warning' : 'info',
    });
  }

  return alerts.sort((a, b) => a.days - b.days);
}

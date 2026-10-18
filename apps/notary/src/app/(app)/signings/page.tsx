import type { Metadata } from 'next';
import Link from 'next/link';
import { requireUser } from '@/lib/auth';
import { prisma } from '@/lib/db';
import type { Prisma } from '@/generated/prisma';
import { formatCents } from '@/lib/money';
import { formatDateTime } from '@/lib/dates';
import {
  OPEN_SIGNING_STATUSES,
  SIGNING_STATUS_LABELS,
  SIGNING_TYPE_LABELS,
  labelFor,
} from '@/lib/domain';
import {
  Badge,
  Card,
  EmptyState,
  LinkButton,
  PageHeader,
  StatTile,
  Table,
  Td,
  Th,
  type Tone,
} from '@/components/ui';

export const metadata: Metadata = { title: 'Signings' };

const FILTERS = [
  { key: 'upcoming', label: 'Upcoming' },
  { key: 'all', label: 'All' },
  { key: 'completed', label: 'Completed' },
  { key: 'unbilled', label: 'Unbilled' },
] as const;

export default async function SigningsPage({
  searchParams,
}: {
  searchParams: Promise<{ view?: string }>;
}) {
  const user = await requireUser();
  const params = await searchParams;
  const view = FILTERS.some((filter) => filter.key === params.view) ? params.view! : 'upcoming';

  const where: Prisma.SigningWhereInput = { userId: user.id };
  if (view === 'upcoming') {
    where.status = { in: [...OPEN_SIGNING_STATUSES] };
  } else if (view === 'completed') {
    where.status = 'COMPLETED';
  } else if (view === 'unbilled') {
    where.status = 'COMPLETED';
    where.invoiceId = null;
  }

  const [signings, counts, unbilled] = await Promise.all([
    prisma.signing.findMany({
      where,
      orderBy: { scheduledAt: view === 'upcoming' ? 'asc' : 'desc' },
      take: 200,
      include: { client: { select: { id: true, name: true } }, _count: { select: { journalEntries: true } } },
    }),
    prisma.signing.groupBy({
      by: ['status'],
      where: { userId: user.id },
      _count: { _all: true },
    }),
    prisma.signing.findMany({
      where: { userId: user.id, status: 'COMPLETED', invoiceId: null },
      select: {
        signingFeeCents: true,
        travelFeeCents: true,
        printFeeCents: true,
        additionalFeeCents: true,
      },
    }),
  ]);

  const openCount = counts
    .filter((row) => OPEN_SIGNING_STATUSES.has(row.status as never))
    .reduce((total, row) => total + row._count._all, 0);
  const completedCount =
    counts.find((row) => row.status === 'COMPLETED')?._count._all ?? 0;
  const unbilledCents = unbilled.reduce(
    (total, signing) =>
      total +
      signing.signingFeeCents +
      signing.travelFeeCents +
      signing.printFeeCents +
      signing.additionalFeeCents,
    0,
  );

  return (
    <>
      <PageHeader
        title="Signings"
        description="Appointments, their status and what they earned."
        actions={
          <LinkButton href="/signings/new" variant="primary">
            Schedule a signing
          </LinkButton>
        }
      />

      <section className="mb-5 grid gap-3 sm:grid-cols-3">
        <StatTile label="Open" value={openCount} sublabel="Scheduled, confirmed or in progress" />
        <StatTile label="Completed" value={completedCount} />
        <StatTile
          label="Completed but unbilled"
          value={formatCents(unbilledCents)}
          tone={unbilledCents > 0 ? 'warning' : 'neutral'}
          sublabel={unbilled.length > 0 ? `${unbilled.length} signings ready to invoice` : 'All billed'}
        />
      </section>

      <div className="mb-4 flex flex-wrap gap-2">
        {FILTERS.map((filter) => (
          <Link
            key={filter.key}
            href={`/signings?view=${filter.key}`}
            className={
              view === filter.key
                ? 'rounded-lg bg-seal-600 px-3 py-1.5 text-sm font-medium text-white'
                : 'rounded-lg border border-[var(--border-strong)] px-3 py-1.5 text-sm font-medium text-[var(--text-muted)] hover:bg-[var(--surface-sunken)]'
            }
          >
            {filter.label}
          </Link>
        ))}
      </div>

      <Card>
        {signings.length === 0 ? (
          <EmptyState
            title="Nothing here"
            description={
              view === 'unbilled'
                ? 'Every completed signing has been invoiced.'
                : 'Schedule a signing and it will appear here.'
            }
            action={
              view === 'unbilled' ? undefined : (
                <LinkButton href="/signings/new" variant="primary">
                  Schedule a signing
                </LinkButton>
              )
            }
          />
        ) : (
          <Table>
            <thead>
              <tr>
                <Th>When</Th>
                <Th>Signing</Th>
                <Th>Client</Th>
                <Th>Type</Th>
                <Th>Status</Th>
                <Th align="right">Acts</Th>
                <Th align="right">Fee</Th>
              </tr>
            </thead>
            <tbody>
              {signings.map((signing) => (
                <tr key={signing.id}>
                  <Td className="whitespace-nowrap text-[var(--text-muted)]">
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
                  <Td className="text-[var(--text-muted)]">
                    {signing.client ? (
                      <Link href={`/clients/${signing.client.id}`} className="hover:underline">
                        {signing.client.name}
                      </Link>
                    ) : (
                      '—'
                    )}
                  </Td>
                  <Td className="text-[var(--text-muted)]">
                    {labelFor(SIGNING_TYPE_LABELS, signing.type)}
                  </Td>
                  <Td>
                    <Badge tone={statusTone(signing.status)}>
                      {labelFor(SIGNING_STATUS_LABELS, signing.status)}
                    </Badge>
                  </Td>
                  <Td align="right" className="tabular">
                    {signing._count.journalEntries}
                  </Td>
                  <Td align="right" className="tabular whitespace-nowrap">
                    {formatCents(
                      signing.signingFeeCents +
                        signing.travelFeeCents +
                        signing.printFeeCents +
                        signing.additionalFeeCents,
                    )}
                  </Td>
                </tr>
              ))}
            </tbody>
          </Table>
        )}
      </Card>
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

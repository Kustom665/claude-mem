import type { Metadata } from 'next';
import Link from 'next/link';
import { requireUser } from '@/lib/auth';
import { prisma } from '@/lib/db';
import type { Prisma } from '@/generated/prisma';
import { journalFieldRulesFor } from '@/lib/compliance';
import { formatCents } from '@/lib/money';
import { formatDateTime } from '@/lib/dates';
import { ACT_TYPES, ACT_TYPE_LABELS, labelFor } from '@/lib/domain';
import {
  Badge,
  Button,
  Card,
  CardBody,
  EmptyState,
  Field,
  Input,
  LinkButton,
  PageHeader,
  Select,
  Table,
  Td,
  Th,
} from '@/components/ui';

export const metadata: Metadata = { title: 'Journal' };

const PAGE_SIZE = 50;

export default async function JournalPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; act?: string; from?: string; to?: string; page?: string }>;
}) {
  const user = await requireUser();
  const params = await searchParams;

  const page = Math.max(1, Number(params.page ?? '1') || 1);
  const query = (params.q ?? '').trim();
  const actType = params.act && ACT_TYPES.includes(params.act as never) ? params.act : '';

  const where: Prisma.JournalEntryWhereInput = { userId: user.id };

  if (query) {
    // SQLite's LIKE is case-insensitive for ASCII by default, which is what
    // `contains` compiles to here. Postgres would need mode: 'insensitive'.
    where.OR = [
      { signerName: { contains: query } },
      { documentType: { contains: query } },
      { documentDescription: { contains: query } },
      { notes: { contains: query } },
    ];
    const asNumber = Number(query);
    if (Number.isInteger(asNumber) && asNumber > 0) {
      where.OR.push({ sequenceNumber: asNumber });
    }
  }

  if (actType) where.actType = actType;

  if (params.from || params.to) {
    where.performedAt = {};
    if (params.from) where.performedAt.gte = new Date(params.from);
    if (params.to) {
      const to = new Date(params.to);
      to.setHours(23, 59, 59, 999);
      where.performedAt.lte = to;
    }
  }

  const [entries, total, feeTotal] = await Promise.all([
    prisma.journalEntry.findMany({
      where,
      orderBy: { sequenceNumber: 'desc' },
      skip: (page - 1) * PAGE_SIZE,
      take: PAGE_SIZE,
      select: {
        id: true,
        sequenceNumber: true,
        performedAt: true,
        actType: true,
        documentType: true,
        signerName: true,
        feeChargedCents: true,
        travelFeeCents: true,
        amendsEntryId: true,
        thumbprintTaken: true,
        notarizedRemotely: true,
      },
    }),
    prisma.journalEntry.count({ where }),
    prisma.journalEntry.aggregate({ where, _sum: { feeChargedCents: true } }),
  ]);

  const fieldRules = journalFieldRulesFor(user.commissionState);
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const exportQuery = new URLSearchParams();
  if (query) exportQuery.set('q', query);
  if (actType) exportQuery.set('act', actType);
  if (params.from) exportQuery.set('from', params.from);
  if (params.to) exportQuery.set('to', params.to);

  return (
    <>
      <PageHeader
        title="Journal"
        description={`${total.toLocaleString('en-US')} ${total === 1 ? 'entry' : 'entries'} · ${formatCents(feeTotal._sum.feeChargedCents ?? 0)} in notarial fees`}
        actions={
          <>
            <LinkButton href="/journal/new" variant="primary">
              Record an act
            </LinkButton>
            <LinkButton href="/journal/verify">Verify chain</LinkButton>
            {fieldRules.publicInspectionRight ? (
              <LinkButton href="/journal/inspect">Inspection view</LinkButton>
            ) : null}
            <LinkButton href={`/journal/print?${exportQuery.toString()}`}>Print</LinkButton>
            <LinkButton href={`/journal/export?${exportQuery.toString()}`}>Export CSV</LinkButton>
          </>
        }
      />

      <Card className="mb-5">
        <CardBody>
          <form method="get" className="grid items-end gap-3 sm:grid-cols-2 lg:grid-cols-5">
            <Field label="Search" htmlFor="q" className="lg:col-span-2">
              <Input
                id="q"
                name="q"
                defaultValue={query}
                placeholder="Signer, document, entry number…"
              />
            </Field>
            <Field label="Act type" htmlFor="act">
              <Select id="act" name="act" defaultValue={actType}>
                <option value="">All acts</option>
                {ACT_TYPES.map((type) => (
                  <option key={type} value={type}>
                    {ACT_TYPE_LABELS[type]}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="From" htmlFor="from">
              <Input id="from" name="from" type="date" defaultValue={params.from ?? ''} />
            </Field>
            <div className="grid grid-cols-2 gap-2">
              <Field label="To" htmlFor="to">
                <Input id="to" name="to" type="date" defaultValue={params.to ?? ''} />
              </Field>
              <div className="flex items-end">
                <Button type="submit" variant="secondary" className="w-full">
                  Filter
                </Button>
              </div>
            </div>
          </form>
        </CardBody>
      </Card>

      <Card>
        {entries.length === 0 ? (
          <EmptyState
            title={total === 0 ? 'No journal entries yet' : 'No entries match those filters'}
            description={
              total === 0
                ? 'Every notarial act you perform gets one entry here, sealed and chained so any later alteration is detectable.'
                : 'Try widening the date range or clearing the search.'
            }
            action={
              total === 0 ? (
                <LinkButton href="/journal/new" variant="primary">
                  Record your first act
                </LinkButton>
              ) : (
                <LinkButton href="/journal">Clear filters</LinkButton>
              )
            }
          />
        ) : (
          <>
            <Table>
              <thead>
                <tr>
                  <Th>No.</Th>
                  <Th>Performed</Th>
                  <Th>Signer</Th>
                  <Th>Act</Th>
                  <Th>Document</Th>
                  <Th align="right">Fee</Th>
                </tr>
              </thead>
              <tbody>
                {entries.map((entry) => (
                  <tr key={entry.id}>
                    <Td className="tabular whitespace-nowrap">
                      <Link
                        href={`/journal/${entry.id}`}
                        className="font-medium text-seal-600 hover:underline"
                      >
                        #{entry.sequenceNumber}
                      </Link>
                      {entry.amendsEntryId ? (
                        <Badge tone="warning" className="ml-1.5">
                          Amendment
                        </Badge>
                      ) : null}
                    </Td>
                    <Td className="whitespace-nowrap text-[var(--text-muted)]">
                      {formatDateTime(entry.performedAt, user.timezone)}
                    </Td>
                    <Td className="font-medium">{entry.signerName}</Td>
                    <Td className="text-[var(--text-muted)]">
                      {labelFor(ACT_TYPE_LABELS, entry.actType)}
                      {entry.notarizedRemotely ? (
                        <Badge tone="info" className="ml-1.5">
                          RON
                        </Badge>
                      ) : null}
                    </Td>
                    <Td className="text-[var(--text-muted)]">
                      {entry.documentType}
                      {entry.thumbprintTaken ? (
                        <span
                          className="ml-1.5 text-xs text-[var(--text-subtle)]"
                          title="Thumbprint recorded"
                        >
                          ✓ print
                        </span>
                      ) : null}
                    </Td>
                    <Td align="right" className="tabular whitespace-nowrap">
                      {formatCents(entry.feeChargedCents)}
                      {entry.travelFeeCents > 0 ? (
                        <span className="block text-xs text-[var(--text-subtle)]">
                          +{formatCents(entry.travelFeeCents)} travel
                        </span>
                      ) : null}
                    </Td>
                  </tr>
                ))}
              </tbody>
            </Table>

            {totalPages > 1 ? (
              <div className="flex items-center justify-between border-t border-[var(--border)] px-5 py-3 text-sm">
                <span className="text-[var(--text-muted)]">
                  Page {page} of {totalPages}
                </span>
                <div className="flex gap-2">
                  {page > 1 ? (
                    <LinkButton href={pageHref(params, page - 1)}>Previous</LinkButton>
                  ) : null}
                  {page < totalPages ? (
                    <LinkButton href={pageHref(params, page + 1)}>Next</LinkButton>
                  ) : null}
                </div>
              </div>
            ) : null}
          </>
        )}
      </Card>
    </>
  );
}

function pageHref(
  params: { q?: string; act?: string; from?: string; to?: string },
  page: number,
): string {
  const search = new URLSearchParams();
  if (params.q) search.set('q', params.q);
  if (params.act) search.set('act', params.act);
  if (params.from) search.set('from', params.from);
  if (params.to) search.set('to', params.to);
  search.set('page', String(page));
  return `/journal?${search.toString()}`;
}

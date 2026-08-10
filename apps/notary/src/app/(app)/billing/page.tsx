import type { Metadata } from 'next';
import Link from 'next/link';
import { requireUser } from '@/lib/auth';
import { prisma } from '@/lib/db';
import { formatCents } from '@/lib/money';
import { formatDate } from '@/lib/dates';
import { INVOICE_STATUS_LABELS, labelFor } from '@/lib/domain';
import { invoiceBalanceCents } from '@/lib/invoicing';
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
import { BillingTabs } from './tabs';

export const metadata: Metadata = { title: 'Billing' };

export default async function BillingPage() {
  const user = await requireUser();
  const now = new Date();

  const [invoices, unbilledCount] = await Promise.all([
    prisma.invoice.findMany({
      where: { userId: user.id },
      orderBy: { issueDate: 'desc' },
      take: 100,
      include: { client: { select: { id: true, name: true } } },
    }),
    prisma.signing.count({
      where: { userId: user.id, status: 'COMPLETED', invoiceId: null },
    }),
  ]);

  const outstanding = invoices
    .filter((invoice) => invoice.status === 'SENT' || invoice.status === 'PARTIAL')
    .reduce((total, invoice) => total + invoiceBalanceCents(invoice), 0);

  const overdue = invoices
    .filter(
      (invoice) =>
        (invoice.status === 'SENT' || invoice.status === 'PARTIAL') &&
        invoice.dueDate.getTime() < now.getTime(),
    )
    .reduce((total, invoice) => total + invoiceBalanceCents(invoice), 0);

  const paidThisYear = invoices
    .filter((invoice) => invoice.status === 'PAID' && invoice.issueDate.getFullYear() === now.getFullYear())
    .reduce((total, invoice) => total + invoice.totalCents, 0);

  return (
    <>
      <PageHeader
        title="Billing"
        description="Invoices, mileage and your fee schedule."
        actions={
          <LinkButton href="/billing/invoices/new" variant="primary">
            New invoice
          </LinkButton>
        }
      />

      <BillingTabs active="invoices" />

      <section className="mb-5 grid gap-3 sm:grid-cols-4">
        <StatTile
          label="Outstanding"
          value={formatCents(outstanding)}
          tone={outstanding > 0 ? 'warning' : 'neutral'}
        />
        <StatTile
          label="Overdue"
          value={formatCents(overdue)}
          tone={overdue > 0 ? 'danger' : 'neutral'}
        />
        <StatTile label="Collected this year" value={formatCents(paidThisYear)} tone="success" />
        <StatTile
          label="Ready to invoice"
          value={unbilledCount}
          sublabel="Completed signings not yet billed"
          tone={unbilledCount > 0 ? 'info' : 'neutral'}
        />
      </section>

      <Card>
        {invoices.length === 0 ? (
          <EmptyState
            title="No invoices yet"
            description="Pick a client and this pulls in every completed signing you have not billed, itemised the way your state requires."
            action={
              <LinkButton href="/billing/invoices/new" variant="primary">
                Create your first invoice
              </LinkButton>
            }
          />
        ) : (
          <Table>
            <thead>
              <tr>
                <Th>Number</Th>
                <Th>Client</Th>
                <Th>Issued</Th>
                <Th>Due</Th>
                <Th>Status</Th>
                <Th align="right">Total</Th>
                <Th align="right">Balance</Th>
              </tr>
            </thead>
            <tbody>
              {invoices.map((invoice) => {
                const balance = invoiceBalanceCents(invoice);
                const isOverdue =
                  (invoice.status === 'SENT' || invoice.status === 'PARTIAL') &&
                  invoice.dueDate.getTime() < now.getTime();

                return (
                  <tr key={invoice.id}>
                    <Td>
                      <Link
                        href={`/billing/invoices/${invoice.id}`}
                        className="font-medium text-seal-600 hover:underline"
                      >
                        {invoice.number}
                      </Link>
                    </Td>
                    <Td>
                      <Link
                        href={`/clients/${invoice.client.id}`}
                        className="text-[var(--text)] hover:underline"
                      >
                        {invoice.client.name}
                      </Link>
                    </Td>
                    <Td className="whitespace-nowrap text-[var(--text-muted)]">
                      {formatDate(invoice.issueDate, user.timezone)}
                    </Td>
                    <Td className="whitespace-nowrap text-[var(--text-muted)]">
                      {formatDate(invoice.dueDate, user.timezone)}
                    </Td>
                    <Td>
                      <Badge tone={isOverdue ? 'danger' : statusTone(invoice.status)}>
                        {isOverdue ? 'Overdue' : labelFor(INVOICE_STATUS_LABELS, invoice.status)}
                      </Badge>
                    </Td>
                    <Td align="right" className="tabular">
                      {formatCents(invoice.totalCents)}
                    </Td>
                    <Td align="right" className="tabular">
                      {balance > 0 ? formatCents(balance) : '—'}
                    </Td>
                  </tr>
                );
              })}
            </tbody>
          </Table>
        )}
      </Card>
    </>
  );
}

function statusTone(status: string): Tone {
  switch (status) {
    case 'PAID':
      return 'success';
    case 'SENT':
      return 'info';
    case 'PARTIAL':
      return 'warning';
    case 'VOID':
      return 'danger';
    default:
      return 'neutral';
  }
}

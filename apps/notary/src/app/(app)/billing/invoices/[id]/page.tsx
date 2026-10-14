import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { requireUser } from '@/lib/auth';
import { prisma } from '@/lib/db';
import { formatCents } from '@/lib/money';
import { formatDate } from '@/lib/dates';
import { INVOICE_STATUS_LABELS, labelFor } from '@/lib/domain';
import { describeBalance, invoiceBalanceCents } from '@/lib/invoicing';
import {
  Badge,
  Button,
  Card,
  CardBody,
  CardHeader,
  LinkButton,
  PageHeader,
  Table,
  Td,
  Th,
  type Tone,
} from '@/components/ui';
import { setInvoiceStatusAction } from '../../actions';
import { PaymentForm } from './payment-form';

export const metadata: Metadata = { title: 'Invoice' };

export default async function InvoicePage({ params }: { params: Promise<{ id: string }> }) {
  const user = await requireUser();
  const { id } = await params;

  const invoice = await prisma.invoice.findFirst({
    where: { id, userId: user.id },
    include: {
      client: true,
      lineItems: { orderBy: { sortOrder: 'asc' } },
      signings: { select: { id: true, title: true } },
    },
  });

  if (!invoice) notFound();

  const balance = invoiceBalanceCents(invoice);

  return (
    <>
      <div className="no-print">
        <PageHeader
          title={`Invoice ${invoice.number}`}
          description={`${invoice.client.name} · ${describeBalance(invoice)}`}
          actions={
            <>
              {invoice.status === 'DRAFT' ? (
                <form action={setInvoiceStatusAction.bind(null, invoice.id, 'SENT')}>
                  <Button type="submit" variant="primary">
                    Mark as sent
                  </Button>
                </form>
              ) : null}
              {invoice.status !== 'PAID' && invoice.status !== 'DRAFT' ? (
                <form action={setInvoiceStatusAction.bind(null, invoice.id, 'PAID')}>
                  <Button type="submit" variant="primary">
                    Mark paid in full
                  </Button>
                </form>
              ) : null}
              <LinkButton href="/billing">All invoices</LinkButton>
            </>
          }
        />
      </div>

      <div className="grid gap-5 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardBody className="space-y-6">
            <div className="flex flex-wrap items-start justify-between gap-4 border-b border-[var(--border)] pb-4">
              <div>
                <h2 className="text-lg font-bold text-[var(--text)]">
                  {user.businessName || user.name}
                </h2>
                {user.businessName ? (
                  <p className="text-sm text-[var(--text-muted)]">{user.name}</p>
                ) : null}
                <p className="mt-1 text-xs text-[var(--text-muted)]">
                  {[user.addressLine1, user.city, user.state, user.postalCode]
                    .filter(Boolean)
                    .join(', ')}
                </p>
                {user.phone ? (
                  <p className="text-xs text-[var(--text-muted)]">{user.phone}</p>
                ) : null}
                {user.commissionNumber ? (
                  <p className="mt-1 text-xs text-[var(--text-subtle)]">
                    Notary commission {user.commissionNumber}
                    {user.commissionState ? ` (${user.commissionState})` : ''}
                  </p>
                ) : null}
              </div>
              <div className="text-right">
                <p className="text-sm font-semibold text-[var(--text)]">{invoice.number}</p>
                <p className="text-xs text-[var(--text-muted)]">
                  Issued {formatDate(invoice.issueDate, user.timezone)}
                </p>
                <p className="text-xs text-[var(--text-muted)]">
                  Due {formatDate(invoice.dueDate, user.timezone)}
                </p>
                <Badge tone={statusTone(invoice.status)} className="mt-1.5">
                  {labelFor(INVOICE_STATUS_LABELS, invoice.status)}
                </Badge>
              </div>
            </div>

            <div>
              <p className="text-xs font-medium tracking-wide text-[var(--text-muted)] uppercase">
                Bill to
              </p>
              <p className="mt-1 text-sm font-medium text-[var(--text)]">{invoice.client.name}</p>
              {invoice.client.contactName ? (
                <p className="text-sm text-[var(--text-muted)]">{invoice.client.contactName}</p>
              ) : null}
              <p className="text-xs text-[var(--text-muted)]">
                {[
                  invoice.client.addressLine1,
                  invoice.client.city,
                  invoice.client.state,
                  invoice.client.postalCode,
                ]
                  .filter(Boolean)
                  .join(', ')}
              </p>
            </div>

            <Table>
              <thead>
                <tr>
                  <Th>Description</Th>
                  <Th align="right">Qty</Th>
                  <Th align="right">Rate</Th>
                  <Th align="right">Amount</Th>
                </tr>
              </thead>
              <tbody>
                {invoice.lineItems.map((item) => (
                  <tr key={item.id}>
                    <Td>{item.description}</Td>
                    <Td align="right" className="tabular">
                      {item.quantity}
                    </Td>
                    <Td align="right" className="tabular">
                      {formatCents(item.unitAmountCents)}
                    </Td>
                    <Td align="right" className="tabular">
                      {formatCents(item.amountCents)}
                    </Td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr>
                  <Td colSpan={3} align="right" className="text-[var(--text-muted)]">
                    Subtotal
                  </Td>
                  <Td align="right" className="tabular">
                    {formatCents(invoice.subtotalCents)}
                  </Td>
                </tr>
                {invoice.taxCents > 0 ? (
                  <tr>
                    <Td colSpan={3} align="right" className="text-[var(--text-muted)]">
                      Tax
                    </Td>
                    <Td align="right" className="tabular">
                      {formatCents(invoice.taxCents)}
                    </Td>
                  </tr>
                ) : null}
                <tr>
                  <Td colSpan={3} align="right" className="font-semibold">
                    Total
                  </Td>
                  <Td align="right" className="tabular text-base font-semibold">
                    {formatCents(invoice.totalCents)}
                  </Td>
                </tr>
                {invoice.amountPaidCents > 0 ? (
                  <>
                    <tr>
                      <Td colSpan={3} align="right" className="text-[var(--text-muted)]">
                        Paid
                      </Td>
                      <Td align="right" className="tabular text-emerald-700">
                        −{formatCents(invoice.amountPaidCents)}
                      </Td>
                    </tr>
                    <tr>
                      <Td colSpan={3} align="right" className="font-semibold">
                        Balance
                      </Td>
                      <Td align="right" className="tabular font-semibold">
                        {formatCents(balance)}
                      </Td>
                    </tr>
                  </>
                ) : null}
              </tfoot>
            </Table>

            {invoice.terms || invoice.notes ? (
              <div className="border-t border-[var(--border)] pt-4 text-xs text-[var(--text-muted)]">
                {invoice.terms ? <p>Terms: {invoice.terms}</p> : null}
                {invoice.notes ? <p className="mt-1">{invoice.notes}</p> : null}
              </div>
            ) : null}
          </CardBody>
        </Card>

        <div className="no-print space-y-5">
          <Card>
            <CardHeader title="Record a payment" />
            <CardBody>
              <PaymentForm
                invoiceId={invoice.id}
                totalCents={invoice.totalCents}
                amountPaidCents={invoice.amountPaidCents}
              />
            </CardBody>
          </Card>

          {invoice.signings.length > 0 ? (
            <Card>
              <CardHeader title="Signings on this invoice" />
              <CardBody>
                <ul className="space-y-1.5">
                  {invoice.signings.map((signing) => (
                    <li key={signing.id}>
                      <Link
                        href={`/signings/${signing.id}`}
                        className="text-sm text-seal-600 hover:underline"
                      >
                        {signing.title}
                      </Link>
                    </li>
                  ))}
                </ul>
              </CardBody>
            </Card>
          ) : null}

          <Card>
            <CardHeader title="Status" />
            <CardBody className="space-y-2">
              {(['DRAFT', 'SENT', 'PAID', 'VOID'] as const).map((status) => (
                <form key={status} action={setInvoiceStatusAction.bind(null, invoice.id, status)}>
                  <Button
                    type="submit"
                    variant={invoice.status === status ? 'primary' : 'secondary'}
                    className="w-full"
                    disabled={invoice.status === status}
                  >
                    {labelFor(INVOICE_STATUS_LABELS, status)}
                  </Button>
                </form>
              ))}
              <p className="pt-1 text-xs text-[var(--text-subtle)]">
                Marking an invoice sent or paid fires the matching webhook, so your automation
                platform can start or stop its reminder sequence.
              </p>
            </CardBody>
          </Card>
        </div>
      </div>
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

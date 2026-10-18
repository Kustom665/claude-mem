import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { requireUser } from '@/lib/auth';
import { prisma } from '@/lib/db';
import { formatCents } from '@/lib/money';
import { formatDateTime } from '@/lib/dates';
import { SIGNING_STATUS_LABELS, labelFor } from '@/lib/domain';
import {
  Badge,
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
import { ClientForm } from '../client-form';
import { updateClientAction } from '../actions';

export const metadata: Metadata = { title: 'Client' };

export default async function ClientPage({ params }: { params: Promise<{ id: string }> }) {
  const user = await requireUser();
  const { id } = await params;

  const client = await prisma.client.findFirst({
    where: { id, userId: user.id },
    include: {
      signings: {
        orderBy: { scheduledAt: 'desc' },
        take: 25,
      },
      invoices: {
        orderBy: { issueDate: 'desc' },
        take: 10,
        select: {
          id: true,
          number: true,
          status: true,
          totalCents: true,
          amountPaidCents: true,
          dueDate: true,
        },
      },
    },
  });

  if (!client) notFound();

  const completed = client.signings.filter((signing) => signing.status === 'COMPLETED');
  const revenue = completed.reduce(
    (total, signing) =>
      total +
      signing.signingFeeCents +
      signing.travelFeeCents +
      signing.printFeeCents +
      signing.additionalFeeCents,
    0,
  );
  const outstanding = client.invoices.reduce(
    (total, invoice) =>
      invoice.status === 'SENT' || invoice.status === 'PARTIAL'
        ? total + invoice.totalCents - invoice.amountPaidCents
        : total,
    0,
  );

  return (
    <>
      <PageHeader
        title={client.name}
        description={client.contactName ?? undefined}
        actions={
          <>
            <LinkButton href={`/signings/new?client=${client.id}`} variant="primary">
              Schedule signing
            </LinkButton>
            <LinkButton href="/clients">All clients</LinkButton>
          </>
        }
      />

      <section className="mb-5 grid gap-3 sm:grid-cols-3">
        <StatTile label="Completed signings" value={completed.length} />
        <StatTile label="Revenue" value={formatCents(revenue)} />
        <StatTile
          label="Outstanding"
          value={formatCents(outstanding)}
          tone={outstanding > 0 ? 'warning' : 'neutral'}
        />
      </section>

      <div className="grid gap-5 lg:grid-cols-2">
        <div className="space-y-5">
          <Card>
            <CardHeader title="Recent signings" />
            {client.signings.length === 0 ? (
              <EmptyState title="No signings for this client yet" />
            ) : (
              <Table>
                <thead>
                  <tr>
                    <Th>When</Th>
                    <Th>Signing</Th>
                    <Th>Status</Th>
                    <Th align="right">Fee</Th>
                  </tr>
                </thead>
                <tbody>
                  {client.signings.map((signing) => (
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
                      </Td>
                      <Td>
                        <Badge
                          tone={
                            signing.status === 'COMPLETED'
                              ? 'success'
                              : signing.status === 'CANCELLED' || signing.status === 'NO_SHOW'
                                ? 'danger'
                                : 'neutral'
                          }
                        >
                          {labelFor(SIGNING_STATUS_LABELS, signing.status)}
                        </Badge>
                      </Td>
                      <Td align="right" className="tabular">
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

          {client.invoices.length > 0 ? (
            <Card>
              <CardHeader title="Invoices" />
              <Table>
                <thead>
                  <tr>
                    <Th>Number</Th>
                    <Th>Status</Th>
                    <Th align="right">Total</Th>
                  </tr>
                </thead>
                <tbody>
                  {client.invoices.map((invoice) => (
                    <tr key={invoice.id}>
                      <Td>
                        <Link
                          href={`/billing/invoices/${invoice.id}`}
                          className="font-medium text-seal-600 hover:underline"
                        >
                          {invoice.number}
                        </Link>
                      </Td>
                      <Td className="text-[var(--text-muted)]">{invoice.status}</Td>
                      <Td align="right" className="tabular">
                        {formatCents(invoice.totalCents)}
                      </Td>
                    </tr>
                  ))}
                </tbody>
              </Table>
            </Card>
          ) : null}
        </div>

        <div>
          <h2 className="mb-3 text-sm font-semibold text-[var(--text)]">Client details</h2>
          <ClientForm
            action={updateClientAction.bind(null, client.id)}
            submitLabel="Save changes"
            values={client}
          />
        </div>
      </div>
    </>
  );
}

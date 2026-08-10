import type { Metadata } from 'next';
import { requireUser } from '@/lib/auth';
import { prisma } from '@/lib/db';
import { formatCents } from '@/lib/money';
import { formatDate } from '@/lib/dates';
import { SIGNING_TYPE_LABELS, labelFor } from '@/lib/domain';
import {
  Alert,
  Card,
  CardBody,
  CardHeader,
  EmptyState,
  Field,
  LinkButton,
  PageHeader,
  Select,
} from '@/components/ui';
import { InvoiceBuilder } from './builder';

export const metadata: Metadata = { title: 'New invoice' };

export default async function NewInvoicePage({
  searchParams,
}: {
  searchParams: Promise<{ client?: string }>;
}) {
  const user = await requireUser();
  const params = await searchParams;

  const clients = await prisma.client.findMany({
    where: { userId: user.id },
    orderBy: { name: 'asc' },
    select: { id: true, name: true, paymentTermsDays: true },
  });

  const selectedClient = params.client
    ? clients.find((client) => client.id === params.client)
    : undefined;

  const signings = selectedClient
    ? await prisma.signing.findMany({
        where: {
          userId: user.id,
          clientId: selectedClient.id,
          status: 'COMPLETED',
          invoiceId: null,
        },
        orderBy: { scheduledAt: 'asc' },
        include: { journalEntries: { select: { feeChargedCents: true } } },
      })
    : [];

  return (
    <>
      <PageHeader
        title="New invoice"
        description="Pulls every completed signing you have not yet billed for this client."
        actions={<LinkButton href="/billing">Back to billing</LinkButton>}
      />

      <div className="max-w-3xl space-y-5">
        <Card>
          <CardHeader title="Client" />
          <CardBody>
            <form method="get">
              <Field label="Invoice which client?" htmlFor="client">
                <Select id="client" name="client" defaultValue={selectedClient?.id ?? ''}>
                  <option value="">Choose a client…</option>
                  {clients.map((client) => (
                    <option key={client.id} value={client.id}>
                      {client.name}
                    </option>
                  ))}
                </Select>
              </Field>
              <button
                type="submit"
                className="focus-ring mt-3 rounded-lg border border-[var(--border-strong)] bg-[var(--surface)] px-3.5 py-2 text-sm font-medium"
              >
                Load unbilled signings
              </button>
            </form>
          </CardBody>
        </Card>

        {clients.length === 0 ? (
          <Alert tone="info" title="No clients yet">
            Add a client before invoicing.{' '}
            <LinkButton href="/clients/new" className="mt-2">
              Add a client
            </LinkButton>
          </Alert>
        ) : null}

        {selectedClient ? (
          signings.length === 0 ? (
            <Card>
              <EmptyState
                title="Nothing to bill"
                description={`Every completed signing for ${selectedClient.name} has already been invoiced.`}
              />
            </Card>
          ) : (
            <InvoiceBuilder
              clientId={selectedClient.id}
              clientName={selectedClient.name}
              termsDays={selectedClient.paymentTermsDays}
              signings={signings.map((signing) => ({
                id: signing.id,
                title: signing.title,
                type: labelFor(SIGNING_TYPE_LABELS, signing.type),
                date: formatDate(signing.scheduledAt, user.timezone),
                notarialCents: signing.journalEntries.reduce(
                  (total, entry) => total + entry.feeChargedCents,
                  0,
                ),
                serviceCents:
                  signing.signingFeeCents +
                  signing.travelFeeCents +
                  signing.printFeeCents +
                  signing.additionalFeeCents,
              }))}
            />
          )
        ) : null}

        <Alert tone="neutral">
          Notarial fees and service fees are written as separate lines. Pennsylvania requires
          non-notarial charges to be itemised, and the split is what supports the self-employment
          tax exemption at year end — worth keeping even where a state does not compel it.
        </Alert>
      </div>
    </>
  );
}

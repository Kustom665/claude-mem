import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { requireUser } from '@/lib/auth';
import { prisma } from '@/lib/db';
import { irsMileageRateCents } from '@/lib/compliance';
import { formatCents } from '@/lib/money';
import { formatDateTime, toDateInputValue, toDateTimeInputValue } from '@/lib/dates';
import { ACT_TYPE_LABELS, SIGNING_STATUS_LABELS, labelFor } from '@/lib/domain';
import {
  Alert,
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
import { SigningForm } from '../signing-form';
import { updateSigningAction } from '../actions';

export const metadata: Metadata = { title: 'Signing' };

export default async function SigningPage({ params }: { params: Promise<{ id: string }> }) {
  const user = await requireUser();
  const { id } = await params;

  const [signing, clients] = await Promise.all([
    prisma.signing.findFirst({
      where: { id, userId: user.id },
      include: {
        client: { select: { id: true, name: true } },
        invoice: { select: { id: true, number: true, status: true } },
        journalEntries: {
          orderBy: { sequenceNumber: 'asc' },
          select: {
            id: true,
            sequenceNumber: true,
            actType: true,
            documentType: true,
            signerName: true,
            feeChargedCents: true,
            performedAt: true,
          },
        },
      },
    }),
    prisma.client.findMany({
      where: { userId: user.id, isActive: true },
      orderBy: { name: 'asc' },
      select: { id: true, name: true, defaultFeeCents: true },
    }),
  ]);

  if (!signing) notFound();

  const nonNotarialCents =
    signing.signingFeeCents +
    signing.travelFeeCents +
    signing.printFeeCents +
    signing.additionalFeeCents;
  const notarialCents = signing.journalEntries.reduce(
    (total, entry) => total + entry.feeChargedCents,
    0,
  );

  return (
    <>
      <PageHeader
        title={signing.title}
        description={`${formatDateTime(signing.scheduledAt, user.timezone)}${
          signing.client ? ` · ${signing.client.name}` : ''
        }`}
        actions={
          <>
            <LinkButton href={`/journal/new?signing=${signing.id}`} variant="primary">
              Record an act
            </LinkButton>
            <LinkButton href="/signings">All signings</LinkButton>
          </>
        }
      />

      {signing.status === 'COMPLETED' && signing.journalEntries.length === 0 ? (
        <Alert tone="warning" title="No journal entries for a completed signing" className="mb-5">
          You marked this signing complete but recorded no notarial acts. If you notarised anything
          here, the journal entry is the legally required record — and it is also where the
          self-employment tax exemption on those fees comes from.
        </Alert>
      ) : null}

      <section className="mb-5 grid gap-3 sm:grid-cols-4">
        <StatTile
          label="Status"
          value={labelFor(SIGNING_STATUS_LABELS, signing.status)}
          tone={signing.status === 'COMPLETED' ? 'success' : 'neutral'}
        />
        <StatTile
          label="Notarial fees"
          value={formatCents(notarialCents)}
          sublabel="From journal · SE-exempt"
          tone="success"
        />
        <StatTile
          label="Service fees"
          value={formatCents(nonNotarialCents)}
          sublabel="Signing, travel, print"
        />
        <StatTile
          label="Mileage"
          value={`${signing.mileageMiles} mi`}
          sublabel={formatCents(Math.round(signing.mileageMiles * irsMileageRateCents(signing.scheduledAt)))}
        />
      </section>

      <div className="mb-5 grid gap-5 lg:grid-cols-2">
        <Card>
          <CardHeader
            title="Notarial acts recorded"
            description={`${signing.journalEntries.length} journal ${signing.journalEntries.length === 1 ? 'entry' : 'entries'}`}
            actions={
              <LinkButton href={`/journal/new?signing=${signing.id}`}>Add entry</LinkButton>
            }
          />
          {signing.journalEntries.length === 0 ? (
            <EmptyState
              title="No acts recorded yet"
              description="Each notarised signature is its own journal entry."
            />
          ) : (
            <Table>
              <thead>
                <tr>
                  <Th>No.</Th>
                  <Th>Act</Th>
                  <Th>Document</Th>
                  <Th align="right">Fee</Th>
                </tr>
              </thead>
              <tbody>
                {signing.journalEntries.map((entry) => (
                  <tr key={entry.id}>
                    <Td className="tabular">
                      <Link
                        href={`/journal/${entry.id}`}
                        className="font-medium text-seal-600 hover:underline"
                      >
                        #{entry.sequenceNumber}
                      </Link>
                    </Td>
                    <Td className="text-[var(--text-muted)]">
                      {labelFor(ACT_TYPE_LABELS, entry.actType)}
                    </Td>
                    <Td className="text-[var(--text-muted)]">{entry.documentType}</Td>
                    <Td align="right" className="tabular">
                      {formatCents(entry.feeChargedCents)}
                    </Td>
                  </tr>
                ))}
              </tbody>
            </Table>
          )}
        </Card>

        <Card>
          <CardHeader title="Billing" />
          <div className="px-5 py-4">
            {signing.invoice ? (
              <p className="text-sm text-[var(--text)]">
                Invoiced on{' '}
                <Link
                  href={`/billing/invoices/${signing.invoice.id}`}
                  className="font-medium text-seal-600 hover:underline"
                >
                  {signing.invoice.number}
                </Link>{' '}
                <Badge tone={signing.invoice.status === 'PAID' ? 'success' : 'neutral'}>
                  {signing.invoice.status}
                </Badge>
              </p>
            ) : signing.status === 'COMPLETED' ? (
              <>
                <p className="text-sm text-[var(--text-muted)]">
                  This signing is complete and has not been invoiced.
                </p>
                <LinkButton
                  href={`/billing/invoices/new?client=${signing.clientId ?? ''}`}
                  className="mt-3"
                  variant="primary"
                >
                  Create invoice
                </LinkButton>
              </>
            ) : (
              <p className="text-sm text-[var(--text-muted)]">
                Mark the signing complete to invoice it.
              </p>
            )}
          </div>
        </Card>
      </div>

      <h2 className="mb-3 text-sm font-semibold text-[var(--text)]">Signing details</h2>
      <div className="max-w-4xl">
        <SigningForm
          action={updateSigningAction.bind(null, signing.id)}
          clients={clients}
          submitLabel="Save changes"
          mileageRateCents={irsMileageRateCents(signing.scheduledAt)}
          values={{
            ...signing,
            scheduledAt: toDateTimeInputValue(signing.scheduledAt, user.timezone),
            docsReturnedAt: signing.docsReturnedAt
              ? toDateInputValue(signing.docsReturnedAt, user.timezone)
              : null,
          }}
        />
      </div>
    </>
  );
}

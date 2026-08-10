import type { Metadata } from 'next';
import Link from 'next/link';
import { requireUser } from '@/lib/auth';
import { prisma } from '@/lib/db';
import { formatCents } from '@/lib/money';
import { CLIENT_TYPE_LABELS, labelFor } from '@/lib/domain';
import {
  Badge,
  Card,
  EmptyState,
  LinkButton,
  PageHeader,
  Table,
  Td,
  Th,
} from '@/components/ui';

export const metadata: Metadata = { title: 'Clients' };

export default async function ClientsPage() {
  const user = await requireUser();

  const clients = await prisma.client.findMany({
    where: { userId: user.id },
    orderBy: [{ isActive: 'desc' }, { name: 'asc' }],
    include: {
      _count: { select: { signings: true } },
      signings: {
        where: { status: 'COMPLETED' },
        select: {
          signingFeeCents: true,
          travelFeeCents: true,
          printFeeCents: true,
          additionalFeeCents: true,
        },
      },
    },
  });

  return (
    <>
      <PageHeader
        title="Clients"
        description="Title companies, escrow officers, signing services and direct clients."
        actions={
          <LinkButton href="/clients/new" variant="primary">
            Add client
          </LinkButton>
        }
      />

      <Card>
        {clients.length === 0 ? (
          <EmptyState
            title="No clients yet"
            description="Add the signing services and title companies you work with, and their fees will pre-fill on every new signing."
            action={
              <LinkButton href="/clients/new" variant="primary">
                Add your first client
              </LinkButton>
            }
          />
        ) : (
          <Table>
            <thead>
              <tr>
                <Th>Client</Th>
                <Th>Type</Th>
                <Th>Contact</Th>
                <Th align="right">Signings</Th>
                <Th align="right">Revenue</Th>
                <Th align="right">Terms</Th>
              </tr>
            </thead>
            <tbody>
              {clients.map((client) => {
                const revenue = client.signings.reduce(
                  (total, signing) =>
                    total +
                    signing.signingFeeCents +
                    signing.travelFeeCents +
                    signing.printFeeCents +
                    signing.additionalFeeCents,
                  0,
                );

                return (
                  <tr key={client.id}>
                    <Td>
                      <Link
                        href={`/clients/${client.id}`}
                        className="font-medium text-seal-600 hover:underline"
                      >
                        {client.name}
                      </Link>
                      {!client.isActive ? (
                        <Badge tone="neutral" className="ml-2">
                          Inactive
                        </Badge>
                      ) : null}
                    </Td>
                    <Td className="text-[var(--text-muted)]">
                      {labelFor(CLIENT_TYPE_LABELS, client.type)}
                    </Td>
                    <Td className="text-[var(--text-muted)]">
                      {client.contactName ?? '—'}
                      {client.phone ? (
                        <span className="block text-xs text-[var(--text-subtle)]">
                          {client.phone}
                        </span>
                      ) : null}
                    </Td>
                    <Td align="right" className="tabular">
                      {client._count.signings}
                    </Td>
                    <Td align="right" className="tabular">
                      {formatCents(revenue)}
                    </Td>
                    <Td align="right" className="tabular text-[var(--text-muted)]">
                      Net {client.paymentTermsDays}
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

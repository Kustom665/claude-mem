import type { Metadata } from 'next';
import { requireUser } from '@/lib/auth';
import { prisma } from '@/lib/db';
import {
  REFERENCE_CAPTURED_ON,
  feeReferenceFor,
  requiresFeeDisclosure,
} from '@/lib/compliance';
import { formatCents } from '@/lib/money';
import { ACT_TYPE_LABELS, FEE_UNIT_LABELS, labelFor } from '@/lib/domain';
import {
  Alert,
  Badge,
  Card,
  CardHeader,
  EmptyState,
  PageHeader,
  Table,
  Td,
  Th,
} from '@/components/ui';
import { BillingTabs } from '../tabs';
import { FeeForm } from './fee-form';
import { DeleteFeeButton } from './delete-button';

export const metadata: Metadata = { title: 'Fee schedule' };

export default async function FeesPage() {
  const user = await requireUser();

  const items = await prisma.feeScheduleItem.findMany({
    where: { userId: user.id },
    orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
  });

  const reference = feeReferenceFor(user.commissionState);
  const mustDisclose = requiresFeeDisclosure(user.commissionState);

  const notarial = items.filter((item) => item.actType !== null);
  const services = items.filter((item) => item.actType === null);

  return (
    <>
      <PageHeader
        title="Fee schedule"
        description="What you charge, and what your state lets you charge for a notarial act."
      />

      <BillingTabs active="fees" />

      {reference ? (
        <Alert
          tone={mustDisclose ? 'warning' : 'info'}
          title={`${user.commissionState} statutory maximums`}
          className="mb-5"
        >
          <p>{reference.note}</p>
          {mustDisclose ? (
            <p className="mt-2 font-medium">
              {user.commissionState} is one of the few states that requires you to disclose your
              fees to the client before performing the act.
            </p>
          ) : null}
          <p className="mt-2 text-xs">
            Reference data captured {REFERENCE_CAPTURED_ON}.{' '}
            <a href={reference.source} target="_blank" rel="noreferrer" className="underline">
              Verify against your commissioning authority
            </a>{' '}
            before relying on it — fee caps change by regulation.
          </p>
        </Alert>
      ) : (
        <Alert tone="warning" title="No reference data for your state" className="mb-5">
          This app does not carry statutory fee maximums for{' '}
          {user.commissionState ?? 'your state'}, so it cannot warn you about overcharging. Look up
          your maximums and record them in the “state max” column below.
        </Alert>
      )}

      <div className="grid gap-5 lg:grid-cols-3">
        <div className="space-y-5 lg:col-span-2">
          <Card>
            <CardHeader
              title="Notarial acts"
              description="Capped by statute. Exempt from self-employment tax."
            />
            {notarial.length === 0 ? (
              <EmptyState title="No notarial fees configured" />
            ) : (
              <FeeTable items={notarial} showActType />
            )}
          </Card>

          <Card>
            <CardHeader
              title="Services"
              description="Not capped. Subject to self-employment tax, and must be itemised separately."
            />
            {services.length === 0 ? (
              <EmptyState title="No service fees configured" />
            ) : (
              <FeeTable items={services} />
            )}
          </Card>
        </div>

        <div>
          <Card>
            <CardHeader title="Add a fee" />
            <div className="px-5 py-4">
              <FeeForm />
            </div>
          </Card>
        </div>
      </div>
    </>
  );
}

type FeeItem = {
  id: string;
  name: string;
  actType: string | null;
  amountCents: number;
  unit: string;
  stateMaxCents: number | null;
  notes: string | null;
  isActive: boolean;
};

function FeeTable({ items, showActType }: { items: FeeItem[]; showActType?: boolean }) {
  return (
    <Table>
      <thead>
        <tr>
          <Th>Name</Th>
          {showActType ? <Th>Act</Th> : null}
          <Th>Unit</Th>
          <Th align="right">Your fee</Th>
          <Th align="right">State max</Th>
          <Th />
        </tr>
      </thead>
      <tbody>
        {items.map((item) => {
          const overMax = item.stateMaxCents !== null && item.amountCents > item.stateMaxCents;
          return (
            <tr key={item.id}>
              <Td>
                <span className="font-medium text-[var(--text)]">{item.name}</span>
                {!item.isActive ? (
                  <Badge tone="neutral" className="ml-2">
                    Inactive
                  </Badge>
                ) : null}
                {item.notes ? (
                  <span className="block text-xs text-[var(--text-subtle)]">{item.notes}</span>
                ) : null}
              </Td>
              {showActType ? (
                <Td className="text-[var(--text-muted)]">
                  {item.actType ? labelFor(ACT_TYPE_LABELS, item.actType) : '—'}
                </Td>
              ) : null}
              <Td className="text-[var(--text-muted)]">{labelFor(FEE_UNIT_LABELS, item.unit)}</Td>
              <Td align="right" className="tabular">
                <span className={overMax ? 'font-semibold text-red-600' : undefined}>
                  {formatCents(item.amountCents)}
                </span>
                {overMax ? (
                  <span className="block text-xs text-red-600">Above state maximum</span>
                ) : null}
              </Td>
              <Td align="right" className="tabular text-[var(--text-muted)]">
                {item.stateMaxCents !== null ? formatCents(item.stateMaxCents) : '—'}
              </Td>
              <Td align="right">
                <DeleteFeeButton itemId={item.id} />
              </Td>
            </tr>
          );
        })}
      </tbody>
    </Table>
  );
}

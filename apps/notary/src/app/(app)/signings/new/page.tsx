import type { Metadata } from 'next';
import { requireUser } from '@/lib/auth';
import { prisma } from '@/lib/db';
import { irsMileageRateCents } from '@/lib/compliance';
import { toDateTimeInputValue } from '@/lib/dates';
import { PageHeader } from '@/components/ui';
import { SigningForm } from '../signing-form';
import { createSigningAction } from '../actions';

export const metadata: Metadata = { title: 'Schedule a signing' };

export default async function NewSigningPage({
  searchParams,
}: {
  searchParams: Promise<{ client?: string }>;
}) {
  const user = await requireUser();
  const params = await searchParams;

  const clients = await prisma.client.findMany({
    where: { userId: user.id, isActive: true },
    orderBy: { name: 'asc' },
    select: { id: true, name: true, defaultFeeCents: true },
  });

  const preselected = params.client
    ? clients.find((client) => client.id === params.client)
    : undefined;

  // Default to the next round hour, which is almost always closer to the real
  // appointment time than "now".
  const start = new Date();
  start.setHours(start.getHours() + 1, 0, 0, 0);

  return (
    <>
      <PageHeader
        title="Schedule a signing"
        description="The appointment. Individual notarial acts get recorded in the journal when you perform them."
      />
      <div className="max-w-4xl">
        <SigningForm
          action={createSigningAction}
          clients={clients}
          submitLabel="Schedule signing"
          mileageRateCents={irsMileageRateCents()}
          values={{
            scheduledAt: toDateTimeInputValue(start, user.timezone),
            clientId: preselected?.id ?? null,
            signingFeeCents: preselected?.defaultFeeCents ?? 0,
            state: user.commissionState,
          }}
        />
      </div>
    </>
  );
}

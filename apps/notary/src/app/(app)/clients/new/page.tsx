import type { Metadata } from 'next';
import { requireUser } from '@/lib/auth';
import { PageHeader } from '@/components/ui';
import { ClientForm } from '../client-form';
import { createClientAction } from '../actions';

export const metadata: Metadata = { title: 'Add client' };

export default async function NewClientPage() {
  const user = await requireUser();

  return (
    <>
      <PageHeader
        title="Add client"
        description="Adding a client also fires the client.created webhook, so your automation platform can start its nurture sequence."
      />
      <div className="max-w-3xl">
        <ClientForm
          action={createClientAction}
          submitLabel="Add client"
          values={{ state: user.commissionState ?? undefined }}
        />
      </div>
    </>
  );
}

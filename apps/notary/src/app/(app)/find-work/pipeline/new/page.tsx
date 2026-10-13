import type { Metadata } from 'next';
import { PageHeader } from '@/components/ui';
import { requireUser } from '@/lib/auth';
import { ApplicationForm } from '../application-form';
import { createProspectAction } from '../../actions';

export const metadata: Metadata = { title: 'Add a prospect' };

export default async function NewProspectPage() {
  await requireUser();

  return (
    <>
      <PageHeader
        title="Add a prospect"
        description="A local title office, law firm, care home or business you want work from — anywhere the directory does not already cover."
      />
      <div className="max-w-3xl">
        <ApplicationForm action={createProspectAction} submitLabel="Add to pipeline" />
      </div>
    </>
  );
}

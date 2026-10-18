import type { Metadata } from 'next';
import { requireUser } from '@/lib/auth';
import { prisma } from '@/lib/db';
import { CERTIFICATE_DISCLAIMER } from '@/lib/certificates';
import { formatDate } from '@/lib/dates';
import { Alert, PageHeader } from '@/components/ui';
import { CertificatePicker } from './picker';

export const metadata: Metadata = { title: 'Certificates' };

export default async function CertificatesPage() {
  const user = await requireUser();

  const templates = await prisma.certificateTemplate.findMany({
    where: { OR: [{ userId: user.id }, { userId: null }] },
    orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
  });

  return (
    <>
      <PageHeader
        title="Certificate wording"
        description="Loose certificates, filled from your commission details and ready to print."
      />

      <Alert tone="warning" className="mb-5">
        {CERTIFICATE_DISCLAIMER}
      </Alert>

      <CertificatePicker
        templates={templates.map((template) => ({
          id: template.id,
          name: template.name,
          actType: template.actType,
          state: template.state,
          body: template.body,
        }))}
        defaults={{
          state: stateName(user.commissionState),
          county: user.commissionCounty ?? '',
          notary_name: user.name,
          commission_number: user.commissionNumber ?? '',
          commission_expires: user.commissionExpiresOn
            ? formatDate(user.commissionExpiresOn, user.timezone)
            : '',
          date: formatDate(new Date(), user.timezone),
        }}
      />
    </>
  );
}

function stateName(code: string | null): string {
  if (!code) return '';
  return code === 'PA' ? 'Pennsylvania' : code;
}

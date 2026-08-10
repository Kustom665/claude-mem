import type { Metadata } from 'next';
import { requireUser } from '@/lib/auth';
import { prisma } from '@/lib/db';
import { MILEAGE_RATE_NOTE } from '@/lib/compliance';
import { formatDate } from '@/lib/dates';
import { Card, CardBody, CardHeader, PageHeader } from '@/components/ui';
import { SettingsTabs } from './tabs';
import { ProfileForm } from './profile-form';
import { SignOutEverywhereButton } from './sign-out-everywhere';

export const metadata: Metadata = { title: 'Settings' };

export default async function SettingsPage() {
  const user = await requireUser();
  const sessionCount = await prisma.session.count({
    where: { userId: user.id, expiresAt: { gt: new Date() } },
  });

  return (
    <>
      <PageHeader title="Settings" description="Your business details and preferences." />
      <SettingsTabs active="profile" />

      <div className="grid max-w-4xl gap-5">
        <ProfileForm
          values={{
            name: user.name,
            businessName: user.businessName,
            phone: user.phone,
            addressLine1: user.addressLine1,
            addressLine2: user.addressLine2,
            city: user.city,
            state: user.state,
            postalCode: user.postalCode,
            timezone: user.timezone,
            mileageRateCents: user.mileageRateCents,
            invoicePrefix: user.invoicePrefix,
            invoiceTermsDays: user.invoiceTermsDays,
          }}
          mileageNote={MILEAGE_RATE_NOTE}
        />

        <Card>
          <CardHeader title="Account" />
          <CardBody className="space-y-3">
            <dl className="grid gap-3 sm:grid-cols-3">
              <div>
                <dt className="text-xs font-medium tracking-wide text-[var(--text-muted)] uppercase">
                  Email
                </dt>
                <dd className="mt-0.5 text-sm text-[var(--text)]">{user.email}</dd>
              </div>
              <div>
                <dt className="text-xs font-medium tracking-wide text-[var(--text-muted)] uppercase">
                  Plan
                </dt>
                <dd className="mt-0.5 text-sm text-[var(--text)]">
                  {user.plan}
                  {user.trialEndsOn ? (
                    <span className="block text-xs text-[var(--text-subtle)]">
                      Trial ends {formatDate(user.trialEndsOn, user.timezone)}
                    </span>
                  ) : null}
                </dd>
              </div>
              <div>
                <dt className="text-xs font-medium tracking-wide text-[var(--text-muted)] uppercase">
                  Active sessions
                </dt>
                <dd className="mt-0.5 text-sm text-[var(--text)]">{sessionCount}</dd>
              </div>
            </dl>
            <div className="border-t border-[var(--border)] pt-3">
              <p className="mb-2 text-xs text-[var(--text-subtle)]">
                Signing out everywhere revokes every session, including this one. Use it if a
                device holding your journal goes missing.
              </p>
              <SignOutEverywhereButton />
            </div>
          </CardBody>
        </Card>
      </div>
    </>
  );
}

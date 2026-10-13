import type { Metadata } from 'next';
import Link from 'next/link';
import { headers } from 'next/headers';
import { requireUser } from '@/lib/auth';
import { ADVERTISING_NOTICE_CAPTURED_ON, advertisingNoticesFor } from '@/lib/compliance';
import { REQUEST_SERVICES, REQUEST_SERVICE_LABELS } from '@/lib/domain';
import {
  checkCanPublish,
  originFromHeaders,
  parseServicesOffered,
  requestPath,
  suggestSlug,
} from '@/lib/request-link';
import { Alert, Card, CardBody, CardHeader, LinkButton, PageHeader } from '@/components/ui';
import { SettingsTabs } from '../tabs';
import { RequestLinkForm } from './request-link-form';

export const metadata: Metadata = { title: 'Request link' };

export default async function RequestLinkSettingsPage() {
  const user = await requireUser();
  const origin = originFromHeaders(await headers());
  const publish = checkCanPublish(user);

  const notices = advertisingNoticesFor(user.commissionState);
  const live = user.acceptingRequests && user.publicSlug && publish.ok;

  return (
    <>
      <PageHeader
        title="Request link"
        description="A page of your own where people can ask you to call them back. Share it on your Google Business Profile, your email signature and your cards."
        actions={
          live && user.publicSlug ? (
            <LinkButton href={requestPath(user.publicSlug)} target="_blank" rel="noreferrer">
              View your page
            </LinkButton>
          ) : null
        }
      />
      <SettingsTabs active="request-link" />

      <div className="max-w-4xl space-y-5">
        {!publish.ok ? (
          <Alert
            tone="warning"
            title="Your link cannot go live yet"
            actions={
              <LinkButton href="/settings/commission" variant="secondary">
                Open commission settings
              </LinkButton>
            }
          >
            {publish.reason}
          </Alert>
        ) : null}

        <RequestLinkForm
          origin={origin}
          canPublish={publish.ok}
          suggestedSlug={suggestSlug({
            businessName: user.businessName,
            name: user.name,
            city: user.city,
          })}
          services={REQUEST_SERVICES.map((service) => ({
            key: service,
            label: REQUEST_SERVICE_LABELS[service],
          }))}
          values={{
            publicSlug: user.publicSlug ?? '',
            acceptingRequests: user.acceptingRequests,
            publicHeadline: user.publicHeadline ?? '',
            publicBio: user.publicBio ?? '',
            serviceArea: user.serviceArea ?? '',
            servicesOffered: parseServicesOffered(user.servicesOffered),
            requestMinNoticeHours: user.requestMinNoticeHours,
            showFeesPublicly: user.showFeesPublicly,
            showPhonePublicly: user.showPhonePublicly,
          }}
        />

        <Card>
          <CardHeader
            title="What your page says about you"
            description={`Added automatically, in ${user.commissionState ?? 'your state'}.`}
          />
          <CardBody className="space-y-3">
            {notices.map((notice) => (
              <p
                key={notice}
                className="rounded-lg border border-[var(--border)] bg-[var(--surface-sunken)] px-3 py-2 text-sm leading-relaxed text-[var(--text)]"
              >
                {notice}
              </p>
            ))}
            <p className="text-xs leading-relaxed text-[var(--text-subtle)]">
              A public page is an advertisement for notarial services, and some states require a
              notary who is not an attorney to say so. This wording was taken from summaries of the
              Pennsylvania Department of State&rsquo;s pages on {ADVERTISING_NOTICE_CAPTURED_ON}, not
              from the statute itself, so confirm it with the Department before you rely on it. The
              page also never asks a requester for an ID number, a date of birth or a document, and
              never says which type of notarization a document needs.
            </p>
          </CardBody>
        </Card>

        <Card>
          <CardHeader title="Getting alerted the moment someone asks" />
          <CardBody>
            <p className="text-sm leading-relaxed text-[var(--text-muted)]">
              Each request is stored here and also sent to your automation platform as a{' '}
              <code>request.created</code> event, so GoHighLevel can text you immediately. Turn
              that event on under{' '}
              <Link href="/settings/integrations" className="text-seal-600 hover:underline">
                Integrations
              </Link>
              . Requests wait in{' '}
              <Link href="/find-work/requests" className="text-seal-600 hover:underline">
                Find work → Requests
              </Link>{' '}
              until you accept, decline or delete them.
            </p>
          </CardBody>
        </Card>
      </div>
    </>
  );
}

import type { Metadata } from 'next';
import { notFound, redirect } from 'next/navigation';
import { deriveSecret } from '@/lib/auth';
import { advertisingNoticesFor, commissionVerificationUrlFor } from '@/lib/compliance';
import { toDateInputValue } from '@/lib/dates';
import { FEE_UNIT_LABELS, REQUEST_SERVICE_LABELS, US_STATES, labelFor } from '@/lib/domain';
import { formatCents } from '@/lib/money';
import { displayNameFor, isTakingRequests, loadPublicNotary } from '@/lib/public-notary';
import { PUBLIC_REQUEST_SECRET_PURPOSE, issueRequestToken } from '@/lib/public-request';
import { parseServicesOffered, requestPath } from '@/lib/request-link';
import { telHref } from '@/lib/requests';
import { Badge, Card, CardBody, CardHeader } from '@/components/ui';
import { RequestForm } from './request-form';

/**
 * Never cached or prerendered: the form token must be fresh for every visitor,
 * and a build must not need the database.
 */
export const dynamic = 'force-dynamic';

type Props = { params: Promise<{ slug: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { slug } = await params;
  const found = await loadPublicNotary(slug);

  if (!found || !isTakingRequests(found.notary)) {
    return { title: { absolute: 'Request a notary' }, robots: { index: false, follow: false } };
  }

  const name = displayNameFor(found.notary);
  return {
    title: { absolute: `${name} — request a notary` },
    description:
      found.notary.publicHeadline ?? `Ask ${name} to call you back about a notarization.`,
  };
}

function Unavailable() {
  return (
    <Card>
      <CardBody className="space-y-2 py-10 text-center">
        <h1 className="text-lg font-semibold text-[var(--text)]">
          This notary is not taking online requests right now
        </h1>
        <p className="text-sm text-[var(--text-muted)]">
          The page is paused. If you were given a phone number or an email address, please use that
          instead.
        </p>
      </CardBody>
    </Card>
  );
}

const READY = [
  'A current, government-issued photo ID for every person who is signing.',
  'The documents, unsigned. Sign only in front of the notary.',
  'Everyone who has to sign, together, at the same time.',
] as const;

export default async function PublicRequestPage({ params }: Props) {
  const { slug: rawSlug } = await params;

  const found = await loadPublicNotary(rawSlug);
  if (!found) notFound();

  const { slug, notary } = found;
  // `/n/Keystone` and `/n/keystone` are one page; keep a single address.
  if (rawSlug !== slug) redirect(requestPath(slug));

  const now = new Date();
  const offered = parseServicesOffered(notary.servicesOffered);
  if (!isTakingRequests(notary, now) || offered.length === 0) return <Unavailable />;

  const name = displayNameFor(notary);
  const stateName =
    US_STATES.find(([code]) => code === notary.commissionState)?.[1] ?? notary.commissionState;
  const phone = notary.showPhonePublicly ? notary.phone : null;
  const tel = telHref(phone);
  const fees = notary.showFeesPublicly ? notary.feeScheduleItems : [];
  const notices = advertisingNoticesFor(notary.commissionState);
  const verifyUrl = commissionVerificationUrlFor(notary.commissionState);

  const token = issueRequestToken(
    slug,
    deriveSecret(PUBLIC_REQUEST_SECRET_PURPOSE),
    now.getTime(),
  );

  return (
    <div className="space-y-5">
      <header className="space-y-3">
        <p className="text-xs font-semibold tracking-wide text-seal-700 uppercase">
          Request a notary
        </p>
        <h1 className="text-3xl font-semibold tracking-tight text-[var(--text)]">{name}</h1>
        {notary.publicHeadline ? (
          <p className="text-lg text-[var(--text-muted)]">{notary.publicHeadline}</p>
        ) : null}

        <div className="flex flex-wrap gap-2">
          <Badge tone="info">
            Commissioned in {stateName}
            {notary.commissionCounty ? `, ${notary.commissionCounty} County` : ''}
          </Badge>
          {notary.isSigningAgent && offered.includes('LOAN_SIGNING') ? (
            <Badge tone="info">Loan signing agent</Badge>
          ) : null}
        </div>

        {notary.publicBio ? (
          <p className="text-sm leading-relaxed whitespace-pre-line text-[var(--text)]">
            {notary.publicBio}
          </p>
        ) : null}
        {notary.serviceArea ? (
          <p className="text-sm text-[var(--text-muted)]">
            <span className="font-medium text-[var(--text)]">Travels to:</span> {notary.serviceArea}
          </p>
        ) : null}
        {phone ? (
          <p className="text-sm text-[var(--text-muted)]">
            Prefer to talk?{' '}
            {tel ? (
              <a href={tel} className="font-medium text-seal-600 hover:underline">
                {phone}
              </a>
            ) : (
              phone
            )}
          </p>
        ) : null}
      </header>

      <Card>
        <CardHeader title="Services" />
        <CardBody>
          <ul className="list-disc space-y-1 pl-5 text-sm text-[var(--text)]">
            {offered.map((service) => (
              <li key={service}>{labelFor(REQUEST_SERVICE_LABELS, service)}</li>
            ))}
          </ul>
        </CardBody>
      </Card>

      {fees.length > 0 ? (
        <Card>
          <CardHeader
            title="Fees"
            description="Your price, including any travel charge, is confirmed with you before the appointment."
          />
          <ul className="divide-y divide-[var(--border)]">
            {fees.map((item) => (
              <li key={item.id} className="flex flex-wrap items-baseline justify-between gap-2 px-5 py-3">
                <span className="min-w-0 text-sm text-[var(--text)]">{item.name}</span>
                <span className="tabular text-sm font-medium text-[var(--text)]">
                  {formatCents(item.amountCents)}
                  <span className="ml-1.5 text-xs font-normal text-[var(--text-subtle)]">
                    {labelFor(FEE_UNIT_LABELS, item.unit)}
                  </span>
                </span>
              </li>
            ))}
          </ul>
        </Card>
      ) : null}

      <Card>
        <CardHeader title="Have these ready" />
        <CardBody>
          <ul className="list-disc space-y-1.5 pl-5 text-sm text-[var(--text)]">
            {READY.map((item) => (
              <li key={item}>{item}</li>
            ))}
          </ul>
          <p className="mt-3 text-xs text-[var(--text-subtle)]">
            {notary.requestMinNoticeHours > 0
              ? `This notary likes about ${notary.requestMinNoticeHours} hours' notice, and will tell you if they can do sooner.`
              : 'Same-day requests are welcome; the notary will tell you what is possible.'}
          </p>
        </CardBody>
      </Card>

      <RequestForm
        slug={slug}
        token={token}
        services={offered.map((service) => ({
          key: service,
          label: REQUEST_SERVICE_LABELS[service],
        }))}
        defaultState={notary.commissionState ?? 'PA'}
        minDate={toDateInputValue(now, notary.timezone)}
      />

      <section aria-label="Notices" className="space-y-2 pb-2 text-xs leading-relaxed text-[var(--text-subtle)]">
        {notices.map((notice) => (
          <p key={notice}>{notice}</p>
        ))}
        {verifyUrl ? (
          <p>
            You can confirm that a Pennsylvania notary holds a current commission with the{' '}
            <a href={verifyUrl} target="_blank" rel="noreferrer" className="underline">
              Department of State&rsquo;s notary search
            </a>
            .
          </p>
        ) : null}
        <p>
          This form never asks for an ID number, a date of birth, a bank detail or a copy of a
          document. Please do not send any.
        </p>
      </section>
    </div>
  );
}

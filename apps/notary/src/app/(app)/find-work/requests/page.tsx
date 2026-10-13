import type { Metadata } from 'next';
import Link from 'next/link';
import { headers } from 'next/headers';
import { requireUser } from '@/lib/auth';
import { prisma } from '@/lib/db';
import {
  CONTACT_PREFERENCE_LABELS,
  REQUEST_SERVICE_LABELS,
  REQUEST_STATUS_LABELS,
  TIME_WINDOW_LABELS,
  labelFor,
} from '@/lib/domain';
import { formatDate, formatDateTime } from '@/lib/dates';
import { findWorkCounts } from '@/lib/find-work-queries';
import { checkCanPublish, originFromHeaders, requestPath } from '@/lib/request-link';
import { mailtoHref, smsHref, telHref, waitingLabel } from '@/lib/requests';
import {
  Alert,
  Badge,
  Button,
  Card,
  CardBody,
  CardHeader,
  DescriptionItem,
  DescriptionList,
  EmptyState,
  LinkButton,
  PageHeader,
  cx,
} from '@/components/ui';
import { ConfirmSubmitButton } from '../confirm-button';
import { requestTone } from '../status';
import { FindWorkTabs } from '../tabs';
import {
  acceptRequestAction,
  deleteRequestAction,
  setRequestStatusAction,
} from '../actions';

export const metadata: Metadata = { title: 'Requests' };

const FILTERS = [
  { key: 'open', label: 'Open', statuses: ['NEW', 'CONTACTED'] },
  { key: 'accepted', label: 'Accepted', statuses: ['ACCEPTED'] },
  { key: 'closed', label: 'Declined & spam', statuses: ['DECLINED', 'SPAM'] },
  { key: 'all', label: 'All', statuses: null },
] as const;

type FilterKey = (typeof FILTERS)[number]['key'];

function isFilterKey(value: string | undefined): value is FilterKey {
  return FILTERS.some((filter) => filter.key === value);
}

const STATUS_ORDER: Record<string, number> = { NEW: 0, CONTACTED: 1 };

export default async function RequestsPage({
  searchParams,
}: {
  searchParams: Promise<{ filter?: string }>;
}) {
  const user = await requireUser();
  const { filter: filterParam } = await searchParams;
  const filterKey: FilterKey = isFilterKey(filterParam) ? filterParam : 'open';
  const filter = FILTERS.find((candidate) => candidate.key === filterKey) ?? FILTERS[0];
  const now = new Date();

  const [requests, grouped, counts, requestHeaders] = await Promise.all([
    prisma.workRequest.findMany({
      where: {
        userId: user.id,
        ...(filter.statuses ? { status: { in: [...filter.statuses] } } : {}),
      },
      orderBy: { createdAt: 'desc' },
      take: 100,
    }),
    prisma.workRequest.groupBy({
      by: ['status'],
      where: { userId: user.id },
      _count: { _all: true },
    }),
    findWorkCounts(user.id, user.timezone, now),
    headers(),
  ]);

  const byStatus = new Map(grouped.map((row) => [row.status, row._count._all]));
  const total = (statuses: readonly string[] | null) =>
    statuses === null
      ? [...byStatus.values()].reduce((sum, value) => sum + value, 0)
      : statuses.reduce((sum, status) => sum + (byStatus.get(status) ?? 0), 0);

  // New before contacted, then newest first within each (the query already put
  // the newest first, and Array.sort is stable).
  const rows = [...requests].sort(
    (a, b) => (STATUS_ORDER[a.status] ?? 9) - (STATUS_ORDER[b.status] ?? 9),
  );

  const publishCheck = checkCanPublish(user, now);
  const live = user.acceptingRequests && user.publicSlug && publishCheck.ok;
  const link = user.publicSlug ? `${originFromHeaders(requestHeaders)}${requestPath(user.publicSlug)}` : null;

  return (
    <>
      <PageHeader
        title="Requests"
        description="People who asked for you through your request link."
        actions={
          <LinkButton href="/settings/request-link" variant="secondary">
            Request link settings
          </LinkButton>
        }
      />
      <FindWorkTabs
        active="requests"
        counts={{ pipeline: counts.followUpsDue, requests: counts.newRequests }}
      />

      <div className="space-y-5">
        {live && link ? (
          <Alert tone="success" title="Your request link is live">
            <span className="break-all font-mono text-xs">{link}</span>
            <span className="mt-1 block text-xs">
              Put it on your Google Business Profile, your email signature and your business card.
            </span>
          </Alert>
        ) : (
          <Alert
            tone="info"
            title="Your request link is off"
            actions={
              <LinkButton href="/settings/request-link" variant="primary">
                Set up your link
              </LinkButton>
            }
          >
            {!publishCheck.ok
              ? publishCheck.reason
              : 'Turn it on and anyone you share it with can ask you to call them back. Nothing they send is booked until you accept it.'}
          </Alert>
        )}

        {counts.newRequests > 0 ? (
          <Alert tone="warning" title={`${counts.newRequests} new ${counts.newRequests === 1 ? 'request' : 'requests'} waiting`}>
            Requesters often contact several notaries. A quick, specific reply is your best
            advantage.
          </Alert>
        ) : null}

        <div className="no-print flex flex-wrap gap-2">
          {FILTERS.map((candidate) => (
            <Link
              key={candidate.key}
              href={candidate.key === 'open' ? '/find-work/requests' : `/find-work/requests?filter=${candidate.key}`}
              className={cx(
                'rounded-full border px-3 py-1 text-xs font-medium',
                candidate.key === filterKey
                  ? 'border-seal-600 bg-seal-600 text-white'
                  : 'border-[var(--border-strong)] text-[var(--text-muted)] hover:bg-[var(--surface-sunken)]',
              )}
            >
              {candidate.label}
              <span className="tabular ml-1.5 opacity-80">{total(candidate.statuses)}</span>
            </Link>
          ))}
        </div>

        {rows.length === 0 ? (
          <Card>
            <EmptyState
              title={filterKey === 'open' ? 'No open requests' : 'Nothing here'}
              description={
                filterKey === 'open'
                  ? 'New requests appear here the moment someone sends one.'
                  : 'Requests you move into this state will be listed here.'
              }
            />
          </Card>
        ) : (
          rows.map((request) => {
            const tel = telHref(request.requesterPhone);
            const sms = smsHref(request.requesterPhone);
            const mail = mailtoHref(request.requesterEmail);
            const open = request.status === 'NEW' || request.status === 'CONTACTED';
            const wanted = request.preferredDate
              ? formatDate(request.preferredDate, 'UTC')
              : 'No date given';
            const window = labelFor(TIME_WINDOW_LABELS, request.preferredWindow);

            return (
              <Card key={request.id}>
                <CardHeader
                  title={
                    <span className="flex flex-wrap items-center gap-2">
                      {request.requesterName}
                      <Badge tone={requestTone(request.status)}>
                        {labelFor(REQUEST_STATUS_LABELS, request.status)}
                      </Badge>
                    </span>
                  }
                  description={`${labelFor(REQUEST_SERVICE_LABELS, request.service)} · received ${formatDateTime(request.createdAt, user.timezone)} (${waitingLabel(request.createdAt, now)})`}
                />
                <CardBody className="space-y-4">
                  <DescriptionList>
                    <DescriptionItem term="Contact">
                      <span className="block space-y-0.5">
                        {request.requesterPhone ? (
                          <span className="flex flex-wrap items-center gap-x-3">
                            {tel ? (
                              <a href={tel} className="font-medium text-seal-600 hover:underline">
                                {request.requesterPhone}
                              </a>
                            ) : (
                              request.requesterPhone
                            )}
                            {sms ? (
                              <a href={sms} className="text-xs text-seal-600 hover:underline">
                                Text
                              </a>
                            ) : null}
                          </span>
                        ) : null}
                        {request.requesterEmail ? (
                          mail ? (
                            <a href={mail} className="block font-medium text-seal-600 hover:underline">
                              {request.requesterEmail}
                            </a>
                          ) : (
                            <span className="block">{request.requesterEmail}</span>
                          )
                        ) : null}
                        <span className="block text-xs text-[var(--text-subtle)]">
                          Prefers{' '}
                          {labelFor(CONTACT_PREFERENCE_LABELS, request.preferredContact).toLowerCase()}
                        </span>
                      </span>
                    </DescriptionItem>

                    <DescriptionItem term="Where">
                      {request.addressLine1 ? <span className="block">{request.addressLine1}</span> : null}
                      {[request.city, request.state].filter(Boolean).join(', ')}
                      {request.postalCode ? ` ${request.postalCode}` : ''}
                    </DescriptionItem>

                    <DescriptionItem term="When">
                      {wanted}
                      <span className="block text-xs text-[var(--text-subtle)]">
                        {window} · {request.signerCount} {request.signerCount === 1 ? 'signer' : 'signers'}
                      </span>
                    </DescriptionItem>

                    <DescriptionItem term="Documents">
                      {request.documentSummary ?? <span className="text-[var(--text-subtle)]">Not described</span>}
                    </DescriptionItem>

                    {request.message ? (
                      <DescriptionItem term="Message" wide>
                        <span className="block whitespace-pre-wrap">{request.message}</span>
                      </DescriptionItem>
                    ) : null}
                  </DescriptionList>

                  <div className="no-print flex flex-wrap items-center gap-2 border-t border-[var(--border)] pt-4">
                    {open ? (
                      <>
                        <form action={acceptRequestAction.bind(null, request.id)}>
                          <Button type="submit" variant="primary">
                            Accept and schedule
                          </Button>
                        </form>
                        {request.status === 'NEW' ? (
                          <form action={setRequestStatusAction.bind(null, request.id, 'CONTACTED')}>
                            <Button type="submit" variant="secondary">
                              Mark contacted
                            </Button>
                          </form>
                        ) : null}
                        <form action={setRequestStatusAction.bind(null, request.id, 'DECLINED')}>
                          <Button type="submit" variant="ghost">
                            Decline
                          </Button>
                        </form>
                        <form action={setRequestStatusAction.bind(null, request.id, 'SPAM')}>
                          <Button type="submit" variant="ghost">
                            Spam
                          </Button>
                        </form>
                      </>
                    ) : null}

                    {request.status === 'ACCEPTED' && request.signingId ? (
                      <LinkButton href={`/signings/${request.signingId}`} variant="secondary">
                        Open the signing
                      </LinkButton>
                    ) : null}

                    {request.status === 'DECLINED' || request.status === 'SPAM' ? (
                      <form action={setRequestStatusAction.bind(null, request.id, 'NEW')}>
                        <Button type="submit" variant="secondary">
                          Reopen
                        </Button>
                      </form>
                    ) : null}

                    <form action={deleteRequestAction.bind(null, request.id)} className="ml-auto">
                      <ConfirmSubmitButton
                        label="Delete"
                        pendingLabel="Deleting…"
                        confirmMessage="Delete this request and the contact details in it? This cannot be undone."
                        variant="ghost"
                      />
                    </form>
                  </div>
                </CardBody>
              </Card>
            );
          })
        )}

        <p className="text-xs text-[var(--text-subtle)]">
          Accepting puts the request on your calendar as a scheduled signing and carries the
          requester&rsquo;s details across. Confirm the time with them first: the date and window they
          chose are only a starting point.
        </p>
      </div>
    </>
  );
}

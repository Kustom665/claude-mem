import type { Metadata } from 'next';
import Link from 'next/link';
import { requireUser } from '@/lib/auth';
import { prisma } from '@/lib/db';
import {
  PIPELINE_STATUSES,
  PIPELINE_STATUS_LABELS,
  SOURCE_CATEGORY_LABELS,
  labelFor,
} from '@/lib/domain';
import { formatDate } from '@/lib/dates';
import { findWorkCounts } from '@/lib/find-work-queries';
import { emptyPipelineCounts, followUpState, type FollowUpState } from '@/lib/pipeline';
import {
  Alert,
  Badge,
  Card,
  EmptyState,
  LinkButton,
  PageHeader,
  StatTile,
  Table,
  Td,
  Th,
} from '@/components/ui';
import { FindWorkTabs } from '../tabs';
import { pipelineTone } from '../status';

export const metadata: Metadata = { title: 'My pipeline' };

const FOLLOW_UP_ORDER: Record<FollowUpState, number> = {
  OVERDUE: 0,
  DUE_SOON: 1,
  SCHEDULED: 2,
  NONE: 3,
};

export default async function PipelinePage() {
  const user = await requireUser();
  const now = new Date();

  const [applications, counts] = await Promise.all([
    prisma.sourceApplication.findMany({ where: { userId: user.id } }),
    findWorkCounts(user.id, user.timezone, now),
  ]);

  const tally = emptyPipelineCounts();
  for (const application of applications) {
    if (application.status in tally) tally[application.status as keyof typeof tally] += 1;
  }

  const statusOrder = new Map<string, number>(PIPELINE_STATUSES.map((status, index) => [status, index]));
  const rows = applications
    .map((application) => ({
      application,
      state: followUpState(application.nextFollowUpOn, application.status, user.timezone, now),
    }))
    .sort(
      (a, b) =>
        FOLLOW_UP_ORDER[a.state] - FOLLOW_UP_ORDER[b.state] ||
        (statusOrder.get(a.application.status) ?? 99) - (statusOrder.get(b.application.status) ?? 99) ||
        a.application.name.localeCompare(b.application.name),
    );

  return (
    <>
      <PageHeader
        title="My pipeline"
        description="Every place you are trying to get work from, and when to ask again."
        actions={
          <>
            <LinkButton href="/find-work/pipeline/new" variant="primary">
              Add a prospect
            </LinkButton>
            <LinkButton href="/find-work">Browse sources</LinkButton>
          </>
        }
      />
      <FindWorkTabs
        active="pipeline"
        counts={{ pipeline: counts.followUpsDue, requests: counts.newRequests }}
      />

      <div className="space-y-5">
        {counts.followUpsOverdue > 0 ? (
          <Alert
            tone="warning"
            title={`${counts.followUpsOverdue} ${counts.followUpsOverdue === 1 ? 'follow-up is' : 'follow-ups are'} overdue`}
          >
            A polite second message is the cheapest work you will ever win. Most applications are
            answered, if at all, after a nudge.
          </Alert>
        ) : null}

        <section className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <StatTile label="Applied" value={tally.APPLIED} sublabel="Waiting to hear back" />
          <StatTile label="Onboarding" value={tally.ONBOARDING} sublabel="Paperwork in progress" />
          <StatTile
            label="Approved"
            value={tally.APPROVED}
            sublabel="On the list, no work yet"
            tone={tally.APPROVED > 0 ? 'info' : 'neutral'}
          />
          <StatTile
            label="Receiving work"
            value={tally.ACTIVE}
            sublabel="Now clients"
            tone={tally.ACTIVE > 0 ? 'success' : 'neutral'}
          />
        </section>

        <Card>
          {rows.length === 0 ? (
            <EmptyState
              title="Nothing in your pipeline yet"
              description="Track a source from the directory, or add a local title office, law firm or care home you want to win."
              action={
                <LinkButton href="/find-work" variant="primary">
                  Browse where work comes from
                </LinkButton>
              }
            />
          ) : (
            <Table>
              <thead>
                <tr>
                  <Th>Source</Th>
                  <Th>Status</Th>
                  <Th>Next follow-up</Th>
                  <Th>Contact</Th>
                  <Th align="right">Applied</Th>
                </tr>
              </thead>
              <tbody>
                {rows.map(({ application, state }) => (
                  <tr key={application.id}>
                    <Td>
                      <Link
                        href={`/find-work/pipeline/${application.id}`}
                        className="font-medium text-seal-600 hover:underline"
                      >
                        {application.name}
                      </Link>
                      <span className="block text-xs text-[var(--text-subtle)]">
                        {labelFor(SOURCE_CATEGORY_LABELS, application.category)}
                      </span>
                    </Td>
                    <Td>
                      <Badge tone={pipelineTone(application.status)}>
                        {labelFor(PIPELINE_STATUS_LABELS, application.status)}
                      </Badge>
                    </Td>
                    <Td className="whitespace-nowrap">
                      {application.nextFollowUpOn && state !== 'NONE' ? (
                        <>
                          {formatDate(application.nextFollowUpOn, user.timezone)}
                          {state === 'OVERDUE' ? (
                            <Badge tone="danger" className="ml-2">
                              Overdue
                            </Badge>
                          ) : state === 'DUE_SOON' ? (
                            <Badge tone="warning" className="ml-2">
                              Due soon
                            </Badge>
                          ) : null}
                        </>
                      ) : (
                        <span className="text-[var(--text-subtle)]">—</span>
                      )}
                    </Td>
                    <Td className="text-[var(--text-muted)]">
                      {application.contactName ?? '—'}
                      {application.contactEmail ? (
                        <span className="block text-xs text-[var(--text-subtle)]">
                          {application.contactEmail}
                        </span>
                      ) : null}
                    </Td>
                    <Td align="right" className="tabular text-[var(--text-muted)]">
                      {application.appliedOn ? formatDate(application.appliedOn, user.timezone) : '—'}
                    </Td>
                  </tr>
                ))}
              </tbody>
            </Table>
          )}
        </Card>
      </div>
    </>
  );
}

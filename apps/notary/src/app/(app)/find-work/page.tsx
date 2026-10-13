import type { Metadata } from 'next';
import Link from 'next/link';
import { requireUser } from '@/lib/auth';
import { prisma } from '@/lib/db';
import {
  PIPELINE_STATUS_LABELS,
  SOURCE_CATEGORIES,
  SOURCE_CATEGORY_LABELS,
  labelFor,
} from '@/lib/domain';
import { formatDate } from '@/lib/dates';
import { findWorkCounts } from '@/lib/find-work-queries';
import { assessReadiness, rankUnlocks } from '@/lib/readiness';
import { parseRequirementList, REQUIREMENT_KEYS, REQUIREMENTS } from '@/lib/requirements';
import {
  compareSourcesForPa,
  EVIDENCE_LABELS,
  PA_RELEVANCE_LABELS,
  WORK_SOURCES,
  workSourcesCapturedOn,
  type WorkSource,
} from '@/lib/work-sources';
import {
  Alert,
  Badge,
  Button,
  Card,
  CardBody,
  CardHeader,
  Checkbox,
  cx,
  EmptyState,
  LinkButton,
  PageHeader,
} from '@/components/ui';
import { FindWorkTabs } from './tabs';
import { ReadinessMeter, RequirementList } from './readiness-ui';
import { saveChecklistAction, trackSourceAction } from './actions';

export const metadata: Metadata = { title: 'Find work' };

const MANUAL_REQUIREMENTS = REQUIREMENT_KEYS.filter((key) => REQUIREMENTS[key].kind === 'MANUAL');

export default async function FindWorkPage({
  searchParams,
}: {
  searchParams: Promise<{ category?: string }>;
}) {
  const user = await requireUser();
  const params = await searchParams;
  const category = SOURCE_CATEGORIES.find((candidate) => candidate === params.category) ?? null;

  const now = new Date();

  const [tracked, counts] = await Promise.all([
    prisma.sourceApplication.findMany({
      where: { userId: user.id, sourceKey: { not: null } },
      select: { id: true, sourceKey: true, status: true },
    }),
    findWorkCounts(user.id, user.timezone, now),
  ]);

  const trackedByKey = new Map(tracked.map((entry) => [entry.sourceKey as string, entry]));
  const manualDone = parseRequirementList(user.readinessChecklist);

  const unlocks = rankUnlocks(WORK_SOURCES, user, manualDone, now).slice(0, 3);
  const readinessByKey = new Map(
    WORK_SOURCES.map((source) => [source.key, assessReadiness(source, user, manualDone, now)]),
  );
  const readyPercent = (source: WorkSource) => readinessByKey.get(source.key)?.percent ?? 0;
  const visible = WORK_SOURCES.filter((source) => !category || source.category === category).sort(
    (a, b) => compareSourcesForPa(a, b, readyPercent),
  );
  const categoryCounts = new Map<string, number>();
  for (const source of WORK_SOURCES) {
    categoryCounts.set(source.category, (categoryCounts.get(source.category) ?? 0) + 1);
  }

  const capturedOn = workSourcesCapturedOn();

  return (
    <>
      <PageHeader
        title="Find work"
        description="Where notarization work comes from, what each source asks of you, and how ready you are to apply."
        actions={
          <LinkButton href="/find-work/pipeline/new" variant="primary">
            Add your own prospect
          </LinkButton>
        }
      />
      <FindWorkTabs
        active="sources"
        counts={{ pipeline: counts.followUpsDue, requests: counts.newRequests }}
      />

      <div className="space-y-5">
        <Alert tone="info" title="A map, not an endorsement">
          {capturedOn ? (
            <>
              Compiled from public pages on {formatDate(capturedOn, 'UTC')}. Some of those pages
              are years old, and requirements and fees change. Treat each entry as a lead and
              confirm the terms on the source&rsquo;s own site before you apply or pay for anything.
            </>
          ) : (
            <>Confirm every requirement on the source&rsquo;s own site before you apply.</>
          )}
        </Alert>

        {unlocks.length > 0 ? (
          <Card>
            <CardHeader
              title="Your fastest next moves"
              description="The fixes that open the most doors for you, counted against every source below."
            />
            <ul className="divide-y divide-[var(--border)]">
              {unlocks.map((unlock) => (
                <li key={unlock.key} className="flex flex-wrap items-start justify-between gap-3 px-5 py-3">
                  <div className="min-w-0">
                    <p className="text-sm font-medium text-[var(--text)]">{unlock.label}</p>
                    <p className="text-xs text-[var(--text-muted)]">{unlock.fix}</p>
                  </div>
                  <div className="flex items-center gap-3 text-right">
                    <span className="text-xs text-[var(--text-muted)]">
                      Needed by {unlock.blocks} {unlock.blocks === 1 ? 'source' : 'sources'}
                      {unlock.soleBlocker > 0 ? ` · the only thing missing for ${unlock.soleBlocker}` : ''}
                    </span>
                    {unlock.fixHref ? (
                      <LinkButton href={unlock.fixHref} className="px-2.5 py-1 text-xs">
                        Fix
                      </LinkButton>
                    ) : null}
                  </div>
                </li>
              ))}
            </ul>
          </Card>
        ) : null}

        <Card>
          <CardHeader
            title="What you already have"
            description="Things the app cannot see. Tick what you hold and it counts toward every source below. Your commission, insurance and background check are read from your settings and cannot be ticked."
          />
          <form action={saveChecklistAction}>
            <CardBody className="grid gap-3 sm:grid-cols-2">
              {MANUAL_REQUIREMENTS.map((key) => (
                <Checkbox
                  key={key}
                  name={`req_${key}`}
                  label={REQUIREMENTS[key].label}
                  hint={REQUIREMENTS[key].detail}
                  defaultChecked={manualDone.has(key)}
                />
              ))}
              <div className="sm:col-span-2">
                <Button type="submit" variant="secondary">
                  Save checklist
                </Button>
              </div>
            </CardBody>
          </form>
        </Card>

        <nav aria-label="Filter by channel" className="flex flex-wrap gap-2">
          <Link
            href="/find-work"
            className={cx(
              'rounded-lg px-3 py-1.5 text-sm font-medium',
              category === null
                ? 'bg-seal-600 text-white'
                : 'border border-[var(--border-strong)] text-[var(--text-muted)] hover:bg-[var(--surface-sunken)]',
            )}
          >
            All ({WORK_SOURCES.length})
          </Link>
          {SOURCE_CATEGORIES.filter((key) => categoryCounts.has(key)).map((key) => (
            <Link
              key={key}
              href={`/find-work?category=${key}`}
              className={cx(
                'rounded-lg px-3 py-1.5 text-sm font-medium',
                category === key
                  ? 'bg-seal-600 text-white'
                  : 'border border-[var(--border-strong)] text-[var(--text-muted)] hover:bg-[var(--surface-sunken)]',
              )}
            >
              {SOURCE_CATEGORY_LABELS[key]} ({categoryCounts.get(key)})
            </Link>
          ))}
        </nav>

        {visible.length === 0 ? (
          <Card>
            <EmptyState
              title="Nothing in this channel yet"
              description="Try another channel, or add a prospect of your own."
              action={
                <LinkButton href="/find-work/pipeline/new" variant="primary">
                  Add your own prospect
                </LinkButton>
              }
            />
          </Card>
        ) : (
          visible.map((source) => {
            const readiness = readinessByKey.get(source.key);
            if (!readiness) return null;
            return (
              <SourceCard
                key={source.key}
                source={source}
                tracked={trackedByKey.get(source.key) ?? null}
                readiness={readiness}
              />
            );
          })
        )}
      </div>
    </>
  );
}

function SourceCard({
  source,
  tracked,
  readiness,
}: {
  source: WorkSource;
  tracked: { id: string; status: string } | null;
  readiness: ReturnType<typeof assessReadiness>;
}) {
  return (
    <Card id={source.key}>
      <CardHeader
        title={source.name}
        description={labelFor(SOURCE_CATEGORY_LABELS, source.category)}
        actions={
          tracked ? (
            <LinkButton href={`/find-work/pipeline/${tracked.id}`}>
              In your pipeline · {labelFor(PIPELINE_STATUS_LABELS, tracked.status)}
            </LinkButton>
          ) : (
            <form action={trackSourceAction.bind(null, source.key)}>
              <Button type="submit">Track this</Button>
            </form>
          )
        }
      />
      <CardBody className="space-y-4">
        <div className="flex flex-wrap gap-2">
          <Badge tone={source.paRelevance === 'HIGH' ? 'info' : 'neutral'}>
            {PA_RELEVANCE_LABELS[source.paRelevance]}
          </Badge>
          <Badge tone={source.evidence === 'ANECDOTAL' ? 'warning' : 'neutral'}>
            {EVIDENCE_LABELS[source.evidence]}
          </Badge>
          <Badge tone="neutral">Checked {formatDate(source.capturedOn, 'UTC')}</Badge>
        </div>

        <p className="text-sm leading-relaxed text-[var(--text)]">{source.howWorkArrives}</p>

        <ReadinessMeter
          percent={readiness.percent}
          satisfied={readiness.satisfied}
          total={readiness.total}
        />
        <RequirementList results={readiness.results} />
        {readiness.takenOnTrust > 0 ? (
          <p className="text-xs text-[var(--text-subtle)]">
            {readiness.takenOnTrust === 1 ? 'One item counts' : `${readiness.takenOnTrust} items count`}{' '}
            because you ticked {readiness.takenOnTrust === 1 ? 'it' : 'them'} in your checklist; the app cannot verify
            them.
          </p>
        ) : null}

        <details className="rounded-lg border border-[var(--border)] px-3 py-2">
          <summary className="cursor-pointer text-sm font-medium text-seal-700">
            How to join ({source.howToJoin.length} {source.howToJoin.length === 1 ? 'step' : 'steps'})
          </summary>
          <ol className="mt-2 list-decimal space-y-1.5 pl-5 text-sm leading-relaxed text-[var(--text-muted)]">
            {source.howToJoin.map((step) => (
              <li key={step}>{step}</li>
            ))}
          </ol>
        </details>

        {source.payNote ? (
          <p className="text-sm leading-relaxed text-[var(--text-muted)]">
            <strong className="font-medium text-[var(--text)]">What is documented about pay.</strong>{' '}
            {source.payNote}
          </p>
        ) : null}

        {source.paNote ? (
          <p className="text-sm leading-relaxed text-[var(--text-muted)]">
            <strong className="font-medium text-[var(--text)]">Pennsylvania.</strong> {source.paNote}
          </p>
        ) : null}

        {source.caveat ? (
          <Alert tone="warning" title="Double-check this">
            {source.caveat}
          </Alert>
        ) : null}

        <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-sm">
          {source.applyUrl ? (
            <a
              href={source.applyUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="font-medium text-seal-600 hover:underline"
            >
              Open the official page ↗
            </a>
          ) : null}
          <details className="text-[var(--text-muted)]">
            <summary className="cursor-pointer text-xs">Where this came from ({source.sources.length})</summary>
            <ul className="mt-1 space-y-0.5 text-xs">
              {source.sources.map((address) => (
                <li key={address}>
                  <a
                    href={address}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="break-all hover:underline"
                  >
                    {address}
                  </a>
                </li>
              ))}
            </ul>
          </details>
        </div>
      </CardBody>
    </Card>
  );
}

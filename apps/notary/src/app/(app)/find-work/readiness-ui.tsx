import Link from 'next/link';
import { Badge, cx, type Tone } from '@/components/ui';
import type { RequirementResult, RequirementStatus } from '@/lib/readiness';

/**
 * How readiness is drawn. Shared by the directory and by a pipeline entry, so a
 * requirement looks the same wherever the notary meets it.
 *
 * Status is always carried in words as well as color — "Missing", "Expiring" —
 * because a traffic-light dot alone is unreadable to a color-blind notary and
 * ambiguous on a printed page.
 */

const STATUS_TONE: Record<RequirementStatus, Tone> = {
  MET: 'success',
  DONE: 'success',
  EXPIRING: 'warning',
  MISSING: 'danger',
  EXPIRED: 'danger',
  TODO: 'neutral',
};

const STATUS_LABEL: Record<RequirementStatus, string> = {
  MET: 'Met',
  DONE: 'Done',
  EXPIRING: 'Expiring',
  MISSING: 'Missing',
  EXPIRED: 'Expired',
  TODO: 'To do',
};

export function ReadinessMeter({
  percent,
  satisfied,
  total,
}: {
  percent: number;
  satisfied: number;
  total: number;
}) {
  const tone = percent === 100 ? 'bg-emerald-600' : percent >= 50 ? 'bg-amber-500' : 'bg-red-500';

  return (
    <div>
      <div className="mb-1 flex items-baseline justify-between text-xs">
        <span className="font-medium text-[var(--text-muted)]">Your readiness</span>
        <span className="tabular text-[var(--text-muted)]">
          {total === 0 ? 'Nothing required' : `${satisfied} of ${total} · ${percent}%`}
        </span>
      </div>
      <div
        role="progressbar"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={percent}
        aria-label="Readiness to apply"
        className="h-2 overflow-hidden rounded-full bg-[var(--surface-sunken)]"
      >
        <div className={cx('h-full rounded-full', tone)} style={{ width: `${percent}%` }} />
      </div>
    </div>
  );
}

export function RequirementList({ results }: { results: RequirementResult[] }) {
  if (results.length === 0) {
    return (
      <p className="text-sm text-[var(--text-muted)]">
        No documented requirements beyond an active commission.
      </p>
    );
  }

  return (
    <ul className="divide-y divide-[var(--border)] rounded-lg border border-[var(--border)]">
      {results.map((result) => (
        <li key={result.key} className="flex flex-wrap items-start justify-between gap-2 px-3 py-2.5">
          <div className="min-w-0">
            <p className="text-sm font-medium text-[var(--text)]">{result.label}</p>
            <p className="text-xs text-[var(--text-muted)]">{result.note}</p>
            {!result.satisfied ? (
              <p className="mt-0.5 text-xs text-[var(--text-subtle)]">
                {result.fix}{' '}
                {result.fixHref ? (
                  <Link href={result.fixHref} className="font-medium text-seal-600 hover:underline">
                    Open settings
                  </Link>
                ) : null}
              </p>
            ) : null}
          </div>
          <Badge tone={STATUS_TONE[result.status]}>{STATUS_LABEL[result.status]}</Badge>
        </li>
      ))}
    </ul>
  );
}

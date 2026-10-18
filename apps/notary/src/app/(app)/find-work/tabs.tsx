import Link from 'next/link';
import { cx } from '@/components/ui';

const TABS = [
  { key: 'sources', href: '/find-work', label: 'Where work comes from' },
  { key: 'pipeline', href: '/find-work/pipeline', label: 'My pipeline' },
  { key: 'requests', href: '/find-work/requests', label: 'Requests' },
] as const;

export type FindWorkTab = (typeof TABS)[number]['key'];

/**
 * `counts` puts a number beside a tab when there is something waiting on the
 * notary — new requests, overdue follow-ups — so the inbox is never a surprise.
 */
export function FindWorkTabs({
  active,
  counts,
}: {
  active: FindWorkTab;
  counts?: Partial<Record<FindWorkTab, number>>;
}) {
  return (
    <div className="no-print mb-5 flex flex-wrap gap-2">
      {TABS.map((tab) => {
        const count = counts?.[tab.key] ?? 0;
        return (
          <Link
            key={tab.key}
            href={tab.href}
            className={cx(
              'inline-flex items-center gap-2 rounded-lg px-3 py-1.5 text-sm font-medium',
              active === tab.key
                ? 'bg-seal-600 text-white'
                : 'border border-[var(--border-strong)] text-[var(--text-muted)] hover:bg-[var(--surface-sunken)]',
            )}
          >
            {tab.label}
            {count > 0 ? (
              <span
                className={cx(
                  'tabular rounded-full px-1.5 text-xs font-semibold',
                  active === tab.key ? 'bg-white/25 text-white' : 'bg-amber-100 text-amber-900',
                )}
                aria-label={`${count} waiting`}
              >
                {count}
              </span>
            ) : null}
          </Link>
        );
      })}
    </div>
  );
}

import Link from 'next/link';
import { cx } from '@/components/ui';

const TABS = [
  { key: 'profile', href: '/settings', label: 'Profile' },
  { key: 'commission', href: '/settings/commission', label: 'Commission & compliance' },
  { key: 'integrations', href: '/settings/integrations', label: 'Integrations' },
] as const;

export function SettingsTabs({ active }: { active: (typeof TABS)[number]['key'] }) {
  return (
    <div className="mb-5 flex flex-wrap gap-2">
      {TABS.map((tab) => (
        <Link
          key={tab.key}
          href={tab.href}
          className={cx(
            'rounded-lg px-3 py-1.5 text-sm font-medium',
            active === tab.key
              ? 'bg-seal-600 text-white'
              : 'border border-[var(--border-strong)] text-[var(--text-muted)] hover:bg-[var(--surface-sunken)]',
          )}
        >
          {tab.label}
        </Link>
      ))}
    </div>
  );
}

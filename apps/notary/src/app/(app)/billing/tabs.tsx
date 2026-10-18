import Link from 'next/link';
import { cx } from '@/components/ui';

const TABS = [
  { key: 'invoices', href: '/billing', label: 'Invoices' },
  { key: 'mileage', href: '/billing/mileage', label: 'Mileage' },
  { key: 'fees', href: '/billing/fees', label: 'Fee schedule' },
] as const;

export function BillingTabs({ active }: { active: (typeof TABS)[number]['key'] }) {
  return (
    <div className="no-print mb-5 flex flex-wrap gap-2">
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

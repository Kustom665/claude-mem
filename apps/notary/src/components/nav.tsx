'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useState } from 'react';
import { cx } from './ui';

const LINKS = [
  { href: '/dashboard', label: 'Dashboard' },
  { href: '/journal', label: 'Journal' },
  { href: '/signings', label: 'Signings' },
  { href: '/clients', label: 'Clients' },
  { href: '/billing', label: 'Billing' },
  { href: '/reports', label: 'Reports' },
  { href: '/certificates', label: 'Certificates' },
  { href: '/settings', label: 'Settings' },
] as const;

function isActive(pathname: string, href: string): boolean {
  if (href === '/dashboard') return pathname === '/dashboard';
  return pathname === href || pathname.startsWith(`${href}/`);
}

export function MainNav({ userName, signOut }: { userName: string; signOut: React.ReactNode }) {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);

  return (
    <header className="no-print sticky top-0 z-20 border-b border-[var(--border)] bg-[var(--surface)]">
      <div className="mx-auto flex max-w-7xl items-center gap-4 px-4 py-3">
        <Link href="/dashboard" className="flex shrink-0 items-center gap-2">
          <span className="flex h-7 w-7 items-center justify-center rounded-md bg-seal-600 text-xs font-bold text-white">
            ND
          </span>
          <span className="hidden text-sm font-semibold tracking-tight text-[var(--text)] sm:block">
            Notary Desk
          </span>
        </Link>

        <nav className="hidden flex-1 items-center gap-0.5 lg:flex">
          {LINKS.map((link) => (
            <Link
              key={link.href}
              href={link.href}
              className={cx(
                'focus-ring rounded-lg px-3 py-1.5 text-sm font-medium transition-colors',
                isActive(pathname, link.href)
                  ? 'bg-seal-50 text-seal-700'
                  : 'text-[var(--text-muted)] hover:bg-[var(--surface-sunken)] hover:text-[var(--text)]',
              )}
            >
              {link.label}
            </Link>
          ))}
        </nav>

        <div className="ml-auto flex items-center gap-2 lg:ml-0">
          <span className="hidden text-sm text-[var(--text-muted)] sm:block">{userName}</span>
          <div className="hidden lg:block">{signOut}</div>
          <button
            type="button"
            onClick={() => setOpen((value) => !value)}
            aria-expanded={open}
            aria-label="Toggle navigation"
            className="focus-ring rounded-lg border border-[var(--border-strong)] px-2.5 py-1.5 text-sm lg:hidden"
          >
            Menu
          </button>
        </div>
      </div>

      {open ? (
        <nav className="border-t border-[var(--border)] px-4 py-2 lg:hidden">
          {LINKS.map((link) => (
            <Link
              key={link.href}
              href={link.href}
              onClick={() => setOpen(false)}
              className={cx(
                'block rounded-lg px-3 py-2 text-sm font-medium',
                isActive(pathname, link.href)
                  ? 'bg-seal-50 text-seal-700'
                  : 'text-[var(--text-muted)]',
              )}
            >
              {link.label}
            </Link>
          ))}
          <div className="px-3 py-2">{signOut}</div>
        </nav>
      ) : null}
    </header>
  );
}

import { useEffect, useState } from 'react';
import { Link, NavLink, Outlet, useLocation } from 'react-router-dom';
import { api } from '../api/client.ts';
import { useAuth } from '../state/auth.tsx';
import { timeAgo } from '../lib/format.ts';
import type { AppNotification } from '../api/types.ts';

const NAV = [
  { to: '/', label: 'Map', end: true },
  { to: '/prices', label: 'Prices' },
  { to: '/yards', label: 'Yards' },
  { to: '/communities', label: 'Groups' },
  { to: '/impact', label: 'Impact' },
];

function Logo() {
  return (
    <Link to="/" className="flex shrink-0 items-center gap-2">
      <span
        className="flex h-8 w-8 items-center justify-center rounded-lg bg-copper-500 text-lg font-black text-white"
        aria-hidden
      >
        S
      </span>
      <span className="text-base font-bold tracking-tight text-zinc-100">
        Scrap<span className="text-copper-400">Map</span>
      </span>
    </Link>
  );
}

function NotificationBell() {
  const { user } = useAuth();
  const [open, setOpen] = useState(false);
  const [items, setItems] = useState<AppNotification[]>([]);
  const [unread, setUnread] = useState(user?.unreadNotifications ?? 0);

  useEffect(() => {
    if (!user) return;
    let cancelled = false;

    const load = async () => {
      try {
        const data = await api.notifications();
        if (cancelled) return;
        setItems(data.notifications);
        setUnread(data.unread);
      } catch {
        // A failed poll is not worth interrupting anyone over.
      }
    };

    void load();
    // Polling beats a websocket for a single-process app at this scale.
    const timer = setInterval(load, 60_000);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [user]);

  if (!user) return null;

  async function toggle() {
    const next = !open;
    setOpen(next);
    if (next && unread > 0) {
      setUnread(0);
      await api.markNotificationsRead().catch(() => undefined);
    }
  }

  return (
    <div className="relative">
      <button
        type="button"
        className="btn-ghost relative px-2.5"
        onClick={() => void toggle()}
        aria-label={`Notifications${unread > 0 ? `, ${unread} unread` : ''}`}
      >
        <span aria-hidden className="text-lg">🔔</span>
        {unread > 0 ? (
          <span className="absolute top-0.5 right-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-copper-500 px-1 text-[10px] font-bold text-white">
            {unread > 9 ? '9+' : unread}
          </span>
        ) : null}
      </button>

      {open ? (
        <>
          <button
            type="button"
            className="fixed inset-0 z-40 cursor-default"
            onClick={() => setOpen(false)}
            aria-label="Close notifications"
          />
          <div className="absolute right-0 z-50 mt-2 max-h-96 w-80 overflow-auto rounded-xl border border-zinc-700 bg-ink-850 shadow-2xl">
            {items.length === 0 ? (
              <p className="px-4 py-6 text-center text-sm text-zinc-500">Nothing yet.</p>
            ) : (
              <ul className="divide-y divide-zinc-800">
                {items.map((item) => (
                  <li key={item.id}>
                    <Link
                      to={item.link ?? '#'}
                      onClick={() => setOpen(false)}
                      className={`block px-4 py-3 hover:bg-ink-800 ${
                        item.readAt ? '' : 'bg-copper-950/20'
                      }`}
                    >
                      <p className="text-sm font-medium text-zinc-200">{item.title}</p>
                      {item.body ? (
                        <p className="mt-0.5 line-clamp-2 text-xs text-zinc-500">{item.body}</p>
                      ) : null}
                      <p className="mt-1 text-[11px] text-zinc-600">{timeAgo(item.createdAt)}</p>
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </>
      ) : null}
    </div>
  );
}

export function Layout() {
  const { user, signOut } = useAuth();
  const location = useLocation();
  const [menuOpen, setMenuOpen] = useState(false);

  useEffect(() => setMenuOpen(false), [location.pathname]);

  const linkClass = ({ isActive }: { isActive: boolean }) =>
    `rounded-lg px-3 py-2 text-sm font-medium transition-colors ${
      isActive ? 'bg-ink-800 text-copper-300' : 'text-zinc-400 hover:bg-ink-800 hover:text-zinc-100'
    }`;

  return (
    <div className="flex min-h-dvh flex-col">
      <header className="sticky top-0 z-500 border-b border-zinc-800 bg-ink-950/95 backdrop-blur">
        <div className="mx-auto flex h-14 max-w-7xl items-center gap-3 px-4">
          <Logo />

          <nav className="hidden items-center gap-1 md:flex">
            {NAV.map((item) => (
              <NavLink key={item.to} to={item.to} end={item.end} className={linkClass}>
                {item.label}
              </NavLink>
            ))}
          </nav>

          <div className="flex-1" />

          {user ? (
            <>
              <NotificationBell />
              <NavLink to="/messages" className={linkClass}>
                Messages
              </NavLink>
              <NavLink to="/dashboard" className={`${linkClass({ isActive: false })} hidden sm:block`}>
                {user.displayName}
              </NavLink>
              <Link to="/post" className="btn-primary hidden sm:inline-flex">
                Post scrap
              </Link>
            </>
          ) : (
            <>
              <Link to="/login" className="btn-ghost hidden sm:inline-flex">
                Sign in
              </Link>
              <Link to="/register" className="btn-primary">
                Join free
              </Link>
            </>
          )}

          <button
            type="button"
            className="btn-ghost px-2 md:hidden"
            onClick={() => setMenuOpen((value) => !value)}
            aria-label="Menu"
            aria-expanded={menuOpen}
          >
            <span aria-hidden className="text-lg">☰</span>
          </button>
        </div>

        {menuOpen ? (
          <nav className="border-t border-zinc-800 px-4 py-2 md:hidden">
            <div className="flex flex-col gap-0.5">
              {NAV.map((item) => (
                <NavLink key={item.to} to={item.to} end={item.end} className={linkClass}>
                  {item.label}
                </NavLink>
              ))}
              {user ? (
                <>
                  <NavLink to="/dashboard" className={linkClass}>
                    My dashboard
                  </NavLink>
                  <NavLink to="/settings" className={linkClass}>
                    Settings
                  </NavLink>
                  <Link to="/post" className="btn-primary mt-2">
                    Post scrap
                  </Link>
                  <button
                    type="button"
                    className="btn-ghost mt-1 justify-start"
                    onClick={() => void signOut()}
                  >
                    Sign out
                  </button>
                </>
              ) : (
                <NavLink to="/login" className={linkClass}>
                  Sign in
                </NavLink>
              )}
            </div>
          </nav>
        ) : null}
      </header>

      <main className="flex-1">
        <Outlet />
      </main>

      <footer className="border-t border-zinc-800 px-4 py-6 text-xs text-zinc-600">
        <div className="mx-auto flex max-w-7xl flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
          <p>
            ScrapMap — keep metal out of the landfill and money in the neighborhood.
          </p>
          <p className="flex flex-wrap gap-x-3 gap-y-1">
            <span>
              Maps &amp; places ©{' '}
              <a
                className="hover:text-zinc-400"
                href="https://www.openstreetmap.org/copyright"
                target="_blank"
                rel="noreferrer noopener"
              >
                OpenStreetMap
              </a>{' '}
              contributors
            </span>
            <span>
              Weather by{' '}
              <a
                className="hover:text-zinc-400"
                href="https://open-meteo.com/"
                target="_blank"
                rel="noreferrer noopener"
              >
                Open-Meteo
              </a>
            </span>
            <span>Copper index via Stooq</span>
          </p>
        </div>
      </footer>

      {/* Thumb-reachable post button on phones. */}
      {user ? (
        <Link
          to="/post"
          className="btn-primary fixed right-4 bottom-4 z-500 shadow-xl shadow-black/40 sm:hidden"
        >
          + Post
        </Link>
      ) : null}
    </div>
  );
}

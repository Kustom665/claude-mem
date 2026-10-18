/**
 * The public side of the app.
 *
 * No navigation and no sign-in: a person who followed a notary's link sees the
 * notary's page and nothing else. Everything under /n is reachable by anyone.
 */
export default function PublicLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen bg-[var(--surface-sunken)]">
      <div className="mx-auto max-w-2xl px-4 py-8 sm:py-12">{children}</div>
      <footer className="mx-auto max-w-2xl px-4 pb-10 text-center text-xs text-[var(--text-subtle)]">
        Request form provided by Notary Desk.
      </footer>
    </div>
  );
}

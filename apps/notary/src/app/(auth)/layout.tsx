import Link from 'next/link';

export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center px-4 py-12">
      <div className="w-full max-w-md">
        <Link href="/" className="mb-8 flex items-center justify-center gap-2.5">
          <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-seal-600 text-sm font-bold text-white">
            ND
          </span>
          <span className="text-lg font-semibold tracking-tight text-[var(--text)]">
            Notary Desk
          </span>
        </Link>
        {children}
      </div>
    </div>
  );
}

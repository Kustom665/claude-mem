import type { Metadata } from 'next';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { getCurrentUser } from '@/lib/auth';
import { SignInForm } from './form';

export const metadata: Metadata = { title: 'Sign in' };

export default async function SignInPage() {
  if (await getCurrentUser()) redirect('/dashboard');

  return (
    <div className="rounded-xl border border-[var(--border)] bg-[var(--surface-raised)] p-6 shadow-sm">
      <h1 className="text-lg font-semibold text-[var(--text)]">Sign in</h1>
      <p className="mt-1 mb-5 text-sm text-[var(--text-muted)]">
        Your journal, signings and books.
      </p>

      <SignInForm />

      <p className="mt-5 text-center text-sm text-[var(--text-muted)]">
        No account yet?{' '}
        <Link href="/sign-up" className="font-medium text-seal-600 hover:underline">
          Create one
        </Link>
      </p>
    </div>
  );
}

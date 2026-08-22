import type { Metadata } from 'next';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { getCurrentUser } from '@/lib/auth';
import { SignUpForm } from './form';

export const metadata: Metadata = { title: 'Create your account' };

export default async function SignUpPage() {
  if (await getCurrentUser()) redirect('/dashboard');

  return (
    <div className="rounded-xl border border-[var(--border)] bg-[var(--surface-raised)] p-6 shadow-sm">
      <h1 className="text-lg font-semibold text-[var(--text)]">Create your account</h1>
      <p className="mt-1 mb-5 text-sm text-[var(--text-muted)]">
        Your state sets your fee caps, your journal rules and your certificate wording, so we ask
        for it up front and pre-load all three.
      </p>

      <SignUpForm />

      <p className="mt-5 text-center text-sm text-[var(--text-muted)]">
        Already have an account?{' '}
        <Link href="/sign-in" className="font-medium text-seal-600 hover:underline">
          Sign in
        </Link>
      </p>
    </div>
  );
}

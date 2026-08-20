import type { Metadata } from "next";

import { signInAction } from "@/actions/auth";
import { AuthForm } from "@/components/auth-form";
import { Alert, Card } from "@/components/ui";

export const metadata: Metadata = { title: "Sign in" };

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const { error } = await searchParams;

  return (
    <Card className="p-8">
      <h1 className="text-xl font-semibold tracking-tight text-slate-900">
        Sign in
      </h1>
      <p className="mt-1 mb-6 text-sm text-slate-500">
        Manage your clients, branding and seats.
      </p>

      {error ? (
        <Alert tone="error" className="mb-5">
          {error}
        </Alert>
      ) : null}

      <AuthForm mode="sign-in" action={signInAction} />
    </Card>
  );
}

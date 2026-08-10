"use client";

import Link from "next/link";
import { useActionState } from "react";

import { SubmitButton } from "@/components/submit-button";
import { Alert, Field, Input } from "@/components/ui";
import { idleFormState, type FormState } from "@/lib/form-state";

type AuthAction = (
  prev: FormState,
  formData: FormData,
) => Promise<FormState>;

export function AuthForm({
  mode,
  action,
}: {
  mode: "sign-in" | "sign-up";
  action: AuthAction;
}) {
  const [state, formAction] = useActionState(action, idleFormState);
  const isSignUp = mode === "sign-up";

  // On sign-up success there is nothing left to submit — the agency has to go
  // and confirm their email address.
  if (isSignUp && state.ok) {
    return (
      <Alert tone="success">{state.message}</Alert>
    );
  }

  return (
    <form action={formAction} className="space-y-5">
      {state.ok === false && state.message ? (
        <Alert tone="error">{state.message}</Alert>
      ) : null}

      {isSignUp ? (
        <Field
          label="Agency name"
          htmlFor="agencyName"
          hint="You can change this later in branding settings."
          error={state.errors?.agencyName}
        >
          <Input
            id="agencyName"
            name="agencyName"
            autoComplete="organization"
            placeholder="Northside Marketing"
            required
          />
        </Field>
      ) : null}

      <Field label="Work email" htmlFor="email" error={state.errors?.email}>
        <Input
          id="email"
          name="email"
          type="email"
          autoComplete="email"
          placeholder="you@agency.com"
          required
        />
      </Field>

      <Field
        label="Password"
        htmlFor="password"
        hint={isSignUp ? "At least 8 characters." : undefined}
        error={state.errors?.password}
      >
        <Input
          id="password"
          name="password"
          type="password"
          autoComplete={isSignUp ? "new-password" : "current-password"}
          minLength={isSignUp ? 8 : undefined}
          required
        />
      </Field>

      <SubmitButton
        className="w-full"
        pendingLabel={isSignUp ? "Creating workspace…" : "Signing in…"}
      >
        {isSignUp ? "Create workspace" : "Sign in"}
      </SubmitButton>

      <p className="text-center text-sm text-slate-500">
        {isSignUp ? "Already have a workspace? " : "Need a workspace? "}
        <Link
          href={isSignUp ? "/login" : "/signup"}
          className="font-medium text-brand hover:underline"
        >
          {isSignUp ? "Sign in" : "Create one"}
        </Link>
      </p>
    </form>
  );
}

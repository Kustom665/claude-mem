import type { Metadata } from "next";

import { signUpAction } from "@/actions/auth";
import { AuthForm } from "@/components/auth-form";
import { Card } from "@/components/ui";

export const metadata: Metadata = { title: "Create your workspace" };

export default function SignUpPage() {
  return (
    <Card className="p-8">
      <h1 className="text-xl font-semibold tracking-tight text-slate-900">
        Create your workspace
      </h1>
      <p className="mt-1 mb-6 text-sm text-slate-500">
        Your agency gets its own branded dashboard and client roster.
      </p>
      <AuthForm mode="sign-up" action={signUpAction} />
    </Card>
  );
}

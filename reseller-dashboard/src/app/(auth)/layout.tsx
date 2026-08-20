import type { ReactNode } from "react";

export default function AuthLayout({ children }: { children: ReactNode }) {
  return (
    <div className="flex min-h-svh flex-1 items-center justify-center px-4 py-12">
      <div className="w-full max-w-md">{children}</div>
    </div>
  );
}

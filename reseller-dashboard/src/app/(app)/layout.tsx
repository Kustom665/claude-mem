import type { ReactNode } from "react";

import { signOutAction } from "@/actions/auth";
import { AgencyMark } from "@/components/agency-mark";
import { SidebarNav } from "@/components/sidebar-nav";
import { requireAgency } from "@/lib/agency";
import { brandStyle } from "@/lib/branding";

/**
 * Auth gate plus theme injection for every signed-in page.
 *
 * `brandStyle` turns `agencies.primary_color` into the CSS custom properties
 * that globals.css maps onto the `brand` Tailwind utilities, so the agency's
 * colour reaches every descendant without any client-side work.
 */
export default async function AppLayout({
  children,
}: {
  children: ReactNode;
}) {
  const { agency, user } = await requireAgency();

  return (
    <div
      style={brandStyle(agency.primary_color)}
      className="flex min-h-svh flex-1 flex-col md:flex-row"
    >
      <aside className="flex shrink-0 flex-col gap-6 border-b border-slate-200 bg-white px-4 py-4 md:w-64 md:border-r md:border-b-0 md:px-4 md:py-6">
        <div className="flex items-center gap-3">
          <AgencyMark name={agency.name} logoUrl={agency.logo_url} />
          <span className="truncate text-sm font-semibold text-slate-900">
            {agency.name}
          </span>
        </div>

        <SidebarNav />

        <div className="mt-auto hidden md:block">
          <p className="truncate px-3 text-xs text-slate-500">{user.email}</p>
          <form action={signOutAction} className="mt-2">
            <button
              type="submit"
              className="w-full rounded-lg px-3 py-2 text-left text-sm font-medium text-slate-600 transition-colors hover:bg-slate-100 hover:text-slate-900"
            >
              Sign out
            </button>
          </form>
        </div>
      </aside>

      <main className="flex-1 px-4 py-6 md:px-8 md:py-10">
        <div className="mx-auto w-full max-w-5xl">{children}</div>

        <form action={signOutAction} className="mt-10 md:hidden">
          <button
            type="submit"
            className="text-sm font-medium text-slate-500 underline"
          >
            Sign out
          </button>
        </form>
      </main>
    </div>
  );
}

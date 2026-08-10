import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

/**
 * Next 16 replaced `middleware.ts` with `proxy.ts`, and the guidance is to keep
 * it thin — routing concerns only, with authorisation done in layouts and route
 * handlers (see src/lib/agency.ts).
 *
 * The one job left here is refreshing Supabase's auth cookies. Server
 * Components cannot write cookies, so without this the access token would
 * expire and never renew.
 */
export async function proxy(request: NextRequest) {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key =
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ??
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  // Let the request through so the page can render a configuration error
  // rather than turning every route into a 500.
  if (!url || !key) return NextResponse.next({ request });

  let response = NextResponse.next({ request });

  const supabase = createServerClient(url, key, {
    cookies: {
      getAll() {
        return request.cookies.getAll();
      },
      setAll(cookiesToSet) {
        for (const { name, value } of cookiesToSet) {
          request.cookies.set(name, value);
        }
        response = NextResponse.next({ request });
        for (const { name, value, options } of cookiesToSet) {
          response.cookies.set(name, value, options);
        }
      },
    },
  });

  // Touching the user is what triggers the refresh-and-set-cookie path.
  await supabase.auth.getUser();

  return response;
}

export const config = {
  matcher: [
    /*
     * Everything except static assets, image optimisation output and the
     * Stripe webhook (which authenticates by signature and has no session).
     */
    "/((?!_next/static|_next/image|api/stripe/webhook|api/automation|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico)$).*)",
  ],
};

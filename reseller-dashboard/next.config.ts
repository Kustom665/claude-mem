import type { NextConfig } from "next";

/**
 * Agency logos are served from Supabase Storage's public object endpoint.
 * We allow the configured project host, plus the generic Supabase host pattern
 * so `next build` still succeeds when the URL is only present at runtime.
 */
function supabaseImageHosts(): string[] {
  const hosts = new Set<string>(["**.supabase.co"]);
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  if (url) {
    try {
      hosts.add(new URL(url).hostname);
    } catch {
      // Ignore a malformed URL here; lib/env.ts reports it at request time.
    }
  }
  return [...hosts];
}

const nextConfig: NextConfig = {
  images: {
    remotePatterns: supabaseImageHosts().map((hostname) => ({
      protocol: "https" as const,
      hostname,
      pathname: "/storage/v1/object/public/**",
    })),
  },
};

export default nextConfig;

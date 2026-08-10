import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  // better-sqlite3 is a native addon; it must stay external to the server
  // bundle rather than being traced and rewritten by the bundler.
  serverExternalPackages: ['@prisma/adapter-better-sqlite3', 'better-sqlite3'],

  typedRoutes: false,
};

export default nextConfig;

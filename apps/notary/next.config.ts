import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  // Driver adapters must stay external to the server bundle rather than being
  // traced and rewritten. better-sqlite3 is a native addon, and pg opens raw
  // sockets; both break when bundled. src/lib/db.ts requires whichever one the
  // DATABASE_URL scheme calls for, so only the relevant one is ever loaded.
  serverExternalPackages: [
    '@prisma/adapter-better-sqlite3',
    'better-sqlite3',
    '@prisma/adapter-pg',
    'pg',
  ],

  typedRoutes: false,
};

export default nextConfig;

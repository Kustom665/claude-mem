import 'dotenv/config';
import { defineConfig } from 'prisma/config';

/**
 * Prisma 7 configuration.
 *
 * The connection URL is no longer allowed in schema.prisma; migrate and
 * introspect read it from here, while the runtime client gets it via a driver
 * adapter in src/lib/db.ts.
 */
export default defineConfig({
  schema: 'prisma/schema.prisma',
  datasource: {
    // Read directly rather than through Prisma's `env()` helper, which throws
    // at config-load time when the variable is missing. `prisma generate` needs
    // no database — it only reads the schema — but the throw happens before
    // Prisma decides that, so an unset DATABASE_URL failed `npm run build`
    // during `prisma generate` with a config-loading error that named neither
    // the variable nor the fix. That is the first thing a fresh Vercel project
    // hits.
    //
    // Generate now succeeds without a URL. Commands that genuinely connect
    // still fail, and say so unambiguously:
    //   Can't reach database server at `DATABASE_URL-is-not-set:5432`
    url: process.env.DATABASE_URL ?? 'postgresql://DATABASE_URL-is-not-set/unset',
  },
  migrations: {
    path: 'prisma/migrations',
    seed: 'tsx prisma/seed.ts',
  },
});

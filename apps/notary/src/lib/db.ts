import path from 'node:path';
import { createRequire } from 'node:module';
import { PrismaClient } from '@/generated/prisma';

/**
 * Both driver adapters are loaded lazily, by URL scheme, through
 * `createRequire`.
 *
 * Neither may be imported statically. `@prisma/adapter-better-sqlite3` pulls in
 * a native `.node` binary, and a static import would drag it into the
 * serverless bundle of a Postgres deployment that never opens a SQLite file —
 * where it either bloats the function or fails to load outright. The client is
 * constructed synchronously, so this is `createRequire` rather than a dynamic
 * `import()`.
 */
type AdapterOptions = ConstructorParameters<typeof PrismaClient>[0];

/**
 * Resolve DATABASE_URL into a path the driver adapter can open.
 *
 * Prisma 7 reads the connection URL from prisma.config.ts at the project root,
 * and resolves a relative `file:` URL against that root — *not* against the
 * directory holding schema.prisma, which is where Prisma 6 and earlier put it.
 * Getting this wrong is silent and nasty: migrations land in one SQLite file
 * while the running app reads an empty one next to it.
 */
function resolveSqliteUrl(rawUrl: string): string {
  const withoutScheme = rawUrl.replace(/^file:/, '');
  if (withoutScheme === ':memory:') return ':memory:';
  if (path.isAbsolute(withoutScheme)) return withoutScheme;
  return path.resolve(process.cwd(), withoutScheme);
}

function loadPostgresAdapter(url: string): AdapterOptions {
  const require = createRequire(import.meta.url);
  try {
    const { PrismaPg } = require('@prisma/adapter-pg') as {
      PrismaPg: new (config: { connectionString: string }) => never;
    };
    return { adapter: new PrismaPg({ connectionString: url }) } as never;
  } catch {
    throw new Error(
      'DATABASE_URL points at PostgreSQL but @prisma/adapter-pg is not installed. ' +
        'Run `npm install @prisma/adapter-pg pg`.',
    );
  }
}

function loadSqliteAdapter(url: string): AdapterOptions {
  const require = createRequire(import.meta.url);
  try {
    const { PrismaBetterSqlite3 } = require('@prisma/adapter-better-sqlite3') as {
      PrismaBetterSqlite3: new (config: { url: string }) => never;
    };
    return { adapter: new PrismaBetterSqlite3({ url: resolveSqliteUrl(url) }) } as never;
  } catch {
    throw new Error(
      'DATABASE_URL points at SQLite but @prisma/adapter-better-sqlite3 is not installed. ' +
        'Run `npm install @prisma/adapter-better-sqlite3`.',
    );
  }
}

function createPrismaClient(): PrismaClient {
  const url = process.env.DATABASE_URL;
  if (!url) {
    throw new Error('DATABASE_URL is not set. Copy .env.example to .env and try again.');
  }

  if (url.startsWith('postgres://') || url.startsWith('postgresql://')) {
    return new PrismaClient(loadPostgresAdapter(url));
  }

  return new PrismaClient(loadSqliteAdapter(url));
}

// Next.js dev mode reloads modules on every edit; without the global cache each
// reload would open another SQLite handle and eventually exhaust them.
const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };

function getClient(): PrismaClient {
  if (!globalForPrisma.prisma) {
    globalForPrisma.prisma = createPrismaClient();
  }
  return globalForPrisma.prisma;
}

/**
 * The Prisma client, connected on first use rather than at import.
 *
 * Importing this module must not open a database handle: modules that hold
 * pure helpers alongside queries get pulled into `next build` and into the test
 * runner, neither of which has (or needs) a live database. The proxy defers
 * construction until a property is actually read.
 */
export const prisma: PrismaClient = new Proxy({} as PrismaClient, {
  get(_target, property, receiver) {
    return Reflect.get(getClient(), property, receiver);
  },
  has(_target, property) {
    return Reflect.has(getClient(), property);
  },
});

export { resolveSqliteUrl };

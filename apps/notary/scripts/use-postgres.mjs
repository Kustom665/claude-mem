#!/usr/bin/env node
/**
 * Switch the Prisma schema from SQLite to PostgreSQL.
 *
 * The application code is already database-agnostic — the schema avoids every
 * SQLite/Postgres divergence (no Prisma enums, no scalar lists, integer cents
 * rather than Float) and src/lib/db.ts picks its driver adapter from the URL
 * scheme at runtime. So this only has to flip the provider and tell you what to
 * do next.
 *
 * The existing SQLite migrations cannot be replayed against Postgres, so they
 * are moved aside rather than deleted: a fresh initial migration is generated
 * against the new provider.
 */

import { readFileSync, writeFileSync, existsSync, renameSync } from 'node:fs';
import path from 'node:path';
import process from 'node:process';

const root = path.resolve(import.meta.dirname, '..');
const schemaPath = path.join(root, 'prisma', 'schema.prisma');
const migrationsPath = path.join(root, 'prisma', 'migrations');

const schema = readFileSync(schemaPath, 'utf8');

if (schema.includes('provider = "postgresql"')) {
  console.log('Schema is already set to postgresql. Nothing to do.');
  process.exit(0);
}

if (!schema.includes('provider = "sqlite"')) {
  console.error('Could not find the sqlite provider line in prisma/schema.prisma.');
  process.exit(1);
}

writeFileSync(schemaPath, schema.replace('provider = "sqlite"', 'provider = "postgresql"'));
console.log('✓ prisma/schema.prisma  →  provider = "postgresql"');

if (existsSync(migrationsPath)) {
  const archived = `${migrationsPath}.sqlite`;
  if (existsSync(archived)) {
    console.log('• prisma/migrations.sqlite already exists; leaving migrations in place.');
  } else {
    renameSync(migrationsPath, archived);
    console.log('✓ prisma/migrations  →  prisma/migrations.sqlite (archived)');
  }
}

console.log(`
Next steps:

  1. Install the PostgreSQL driver adapter:
       npm install @prisma/adapter-pg pg

  2. Point DATABASE_URL at your database, e.g. in .env:
       DATABASE_URL="postgresql://user:password@host:5432/notarydesk?schema=public"

  3. Generate and apply the initial migration:
       npx prisma migrate dev -n init

  4. Optionally load demo data:
       npm run db:seed

Nothing in src/ needs to change — the adapter is selected from the URL scheme.

Note on existing journals: the hash chain is computed over normalised values,
and dates are normalised to ISO strings, so a journal exported from SQLite and
imported into Postgres still verifies. Move the rows, then open
/journal/verify to confirm before trusting the migrated data.
`);

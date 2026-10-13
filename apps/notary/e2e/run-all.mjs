import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * Run every browser flow against a running, built app.
 *
 * The flows change what they touch (they accept requests, record a journal
 * entry), so the demo data is reseeded before each one that needs a known
 * starting point. `verify-chain` deliberately runs straight after `flows-misc`
 * to confirm the journal still verifies after entries were added through the app.
 *
 *   E2E_ADMIN_DATABASE_URL  a connection string that can write to the app's database
 *                           (used only to reseed; the app itself may use a narrower role)
 *   E2E_BASE_URL, CHROMIUM_PATH, PGHOST/PGPORT/PGUSER/PGPASSWORD/PGDATABASE — see lib.mjs and db.mjs
 *
 * See e2e/README.md.
 */

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..');

const FLOWS = [
  { file: 'smoke.mjs', reseed: true },
  { file: 'public-form.mjs', reseed: true },
  { file: 'flows-inbox.mjs', reseed: true },
  { file: 'flows-settings.mjs', reseed: true },
  { file: 'flows-pipeline.mjs', reseed: true },
  { file: 'flows-signing.mjs', reseed: true },
  { file: 'flows-pending.mjs', reseed: true },
  { file: 'flows-misc.mjs', reseed: true },
  { file: 'verify-chain.mjs', reseed: false },
];

const adminUrl = process.env.E2E_ADMIN_DATABASE_URL;
if (!adminUrl) {
  console.error('Set E2E_ADMIN_DATABASE_URL to a connection string that can write to the app database.');
  process.exit(2);
}

function reseed() {
  const result = spawnSync('npx', ['tsx', 'prisma/seed.ts'], {
    cwd: root,
    env: { ...process.env, DATABASE_URL: adminUrl },
    encoding: 'utf8',
  });
  if (result.status !== 0) {
    console.error(result.stdout, result.stderr);
    throw new Error('Reseeding the demo data failed.');
  }
}

const only = process.argv.slice(2);
const failures = [];

for (const flow of FLOWS) {
  if (only.length > 0 && !only.some((name) => flow.file.includes(name))) continue;

  console.log(`\n=== ${flow.file} ${'='.repeat(Math.max(0, 60 - flow.file.length))}`);
  if (flow.reseed) reseed();

  const result = spawnSync('node', [path.join(here, flow.file)], {
    cwd: root,
    env: process.env,
    stdio: 'inherit',
  });
  if (result.status !== 0) failures.push(flow.file);
}

console.log('\n' + '-'.repeat(68));
if (failures.length > 0) {
  console.log(`FAILED: ${failures.join(', ')}`);
  process.exit(1);
}
console.log('All browser flows passed.');

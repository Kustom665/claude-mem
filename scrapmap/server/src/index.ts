import { createApp } from './app.ts';
import { pruneCache } from './db/cache.ts';
import { getDb } from './db/index.ts';
import { env, ensureDirectories } from './env.ts';
import { expireStaleListings } from './services/maintenance.ts';

ensureDirectories();
getDb();

const removed = pruneCache();
const expired = expireStaleListings();

const app = createApp();
const server = app.listen(env.port, () => {
  console.log(`ScrapMap API listening on http://localhost:${env.port}`);
  console.log(`  database   ${env.databaseFile}`);
  console.log(`  uploads    ${env.uploadDir}`);
  console.log(`  cors       ${env.corsOrigins.join(', ') || '(none)'}`);
  if (env.offlineMode) {
    console.log('  offline    OFFLINE_MODE is on: no third-party API calls will be made');
  }
  if (removed > 0 || expired > 0) {
    console.log(`  startup    pruned ${removed} cache rows, expired ${expired} listings`);
  }
});

// Listings age out on a timer as well as at boot, so a long-running process
// does not keep month-old scrap on the map.
const sweep = setInterval(
  () => {
    try {
      pruneCache();
      expireStaleListings();
    } catch (error) {
      console.error('[scrapmap] maintenance sweep failed:', error);
    }
  },
  6 * 60 * 60 * 1000,
);
sweep.unref();

function shutdown(signal: string): void {
  console.log(`\n${signal} received, shutting down.`);
  clearInterval(sweep);
  server.close(() => process.exit(0));
  // Do not hang forever on a stuck keep-alive connection.
  setTimeout(() => process.exit(1), 5000).unref();
}

process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));

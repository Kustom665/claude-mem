/**
 * Test environment. Imported first by the test file so these are set before
 * env.ts reads them — ES modules evaluate dependencies in source order, so an
 * `import './setup.ts'` on line one runs ahead of everything below it.
 */
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const dir = mkdtempSync(join(tmpdir(), 'scrapmap-test-'));

process.env.NODE_ENV = 'test';
process.env.DATA_DIR = dir;
process.env.DATABASE_FILE = join(dir, 'test.db');
process.env.UPLOAD_DIR = join(dir, 'uploads');
process.env.SESSION_SECRET = 'test-secret-not-used-anywhere-real';
// Tests must never touch a real third-party endpoint: it would make them slow,
// flaky, and rude to free services.
process.env.OFFLINE_MODE = '1';

process.on('exit', () => {
  rmSync(dir, { recursive: true, force: true });
});

export const TEST_DIR = dir;

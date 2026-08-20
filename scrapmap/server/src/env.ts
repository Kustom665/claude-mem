import { randomBytes } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, isAbsolute, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
/** Repo-relative root of the server workspace, whether running from src/ or dist/. */
export const SERVER_ROOT = resolve(here, '..');

/**
 * Minimal .env loader. Node 22 ships `--env-file`, but reading the file
 * ourselves means `npm test` and one-off scripts pick up the same config
 * without every entry point needing the flag.
 */
function loadDotEnv(): void {
  for (const name of ['.env.local', '.env']) {
    const file = join(SERVER_ROOT, '..', name);
    if (!existsSync(file)) continue;
    for (const rawLine of readFileSync(file, 'utf8').split('\n')) {
      const line = rawLine.trim();
      if (!line || line.startsWith('#')) continue;
      const eq = line.indexOf('=');
      if (eq === -1) continue;
      const key = line.slice(0, eq).trim();
      let value = line.slice(eq + 1).trim();
      if (
        (value.startsWith('"') && value.endsWith('"')) ||
        (value.startsWith("'") && value.endsWith("'"))
      ) {
        value = value.slice(1, -1);
      }
      if (process.env[key] === undefined) process.env[key] = value;
    }
  }
}

loadDotEnv();

function str(key: string, fallback: string): string {
  const value = process.env[key];
  return value === undefined || value === '' ? fallback : value;
}

function int(key: string, fallback: number): number {
  const parsed = Number.parseInt(process.env[key] ?? '', 10);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function bool(key: string, fallback: boolean): boolean {
  const value = process.env[key];
  if (value === undefined || value === '') return fallback;
  return value === '1' || value.toLowerCase() === 'true';
}

function absolute(pathish: string): string {
  return isAbsolute(pathish) ? pathish : resolve(SERVER_ROOT, pathish);
}

const dataDir = absolute(str('DATA_DIR', './data'));

/**
 * Session secret resolution order: explicit env var, then a generated secret
 * persisted under DATA_DIR. Persisting means restarting the dev server does not
 * silently log everybody out, while still requiring zero setup on a fresh clone.
 */
function resolveSessionSecret(): string {
  const fromEnv = process.env.SESSION_SECRET;
  if (fromEnv) return fromEnv;
  if (process.env.NODE_ENV === 'production') {
    throw new Error(
      'SESSION_SECRET must be set in production. Generate one with: openssl rand -hex 32',
    );
  }
  mkdirSync(dataDir, { recursive: true });
  const secretFile = join(dataDir, '.session-secret');
  if (existsSync(secretFile)) return readFileSync(secretFile, 'utf8').trim();
  const generated = randomBytes(32).toString('hex');
  writeFileSync(secretFile, generated, { mode: 0o600 });
  return generated;
}

export const env = {
  nodeEnv: str('NODE_ENV', 'development'),
  isProduction: str('NODE_ENV', 'development') === 'production',
  isTest: str('NODE_ENV', 'development') === 'test',
  port: int('PORT', 4000),

  dataDir,
  databaseFile: str('DATABASE_FILE', join(dataDir, 'scrapmap.db')),
  uploadDir: absolute(str('UPLOAD_DIR', join(dataDir, 'uploads'))),

  get sessionSecret(): string {
    return resolveSessionSecret();
  },
  sessionTtlDays: int('SESSION_TTL_DAYS', 30),

  corsOrigins: str('CORS_ORIGIN', 'http://localhost:5173')
    .split(',')
    .map((origin) => origin.trim())
    .filter(Boolean),

  /** When true, no outbound HTTP happens: services fall back to cache + built-in data. */
  offlineMode: bool('OFFLINE_MODE', false),

  /**
   * Per-IP limits are on everywhere except tests, where every request comes
   * from 127.0.0.1 and would trip the registration limit within one suite.
   */
  rateLimitEnabled: bool('RATE_LIMIT_ENABLED', str('NODE_ENV', 'development') !== 'test'),

  osmUserAgent: str(
    'OSM_USER_AGENT',
    'ScrapMap/1.0 (https://github.com/your-org/scrapmap; contact@example.com)',
  ),
  nominatimBaseUrl: str('NOMINATIM_BASE_URL', 'https://nominatim.openstreetmap.org'),
  overpassBaseUrl: str('OVERPASS_BASE_URL', 'https://overpass-api.de/api/interpreter'),
  openMeteoBaseUrl: str('OPEN_METEO_BASE_URL', 'https://api.open-meteo.com/v1/forecast'),
  stooqBaseUrl: str('STOOQ_BASE_URL', 'https://stooq.com/q/l/'),

  maxUploadBytes: int('MAX_UPLOAD_BYTES', 6 * 1024 * 1024),
  maxPhotosPerListing: int('MAX_PHOTOS_PER_LISTING', 8),
} as const;

export function ensureDirectories(): void {
  mkdirSync(env.dataDir, { recursive: true });
  mkdirSync(env.uploadDir, { recursive: true });
}

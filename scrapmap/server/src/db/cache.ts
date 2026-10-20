import { execute, getDb, nowIso, queryOne } from './index.ts';

interface CacheRow {
  payload: string;
  fetched_at: string;
  expires_at: string;
}

export interface CacheEntry<T> {
  value: T;
  fetchedAt: string;
  stale: boolean;
}

/** Reads a cache entry, including expired ones so callers can serve stale data. */
export function readCache<T>(key: string): CacheEntry<T> | null {
  const row = queryOne<CacheRow>(
    'SELECT payload, fetched_at, expires_at FROM api_cache WHERE key = ?',
    [key],
  );
  if (!row) return null;
  try {
    return {
      value: JSON.parse(row.payload) as T,
      fetchedAt: row.fetched_at,
      stale: new Date(row.expires_at).getTime() < Date.now(),
    };
  } catch {
    execute('DELETE FROM api_cache WHERE key = ?', [key]);
    return null;
  }
}

export function writeCache(key: string, value: unknown, ttlSeconds: number): void {
  const now = new Date();
  execute(
    `INSERT INTO api_cache (key, payload, fetched_at, expires_at)
     VALUES (?, ?, ?, ?)
     ON CONFLICT (key) DO UPDATE SET
       payload = excluded.payload,
       fetched_at = excluded.fetched_at,
       expires_at = excluded.expires_at`,
    [
      key,
      JSON.stringify(value),
      now.toISOString(),
      new Date(now.getTime() + ttlSeconds * 1000).toISOString(),
    ],
  );
}

export interface CachedResult<T> {
  value: T;
  /** 'live' hit the upstream, 'cache' was fresh, 'stale' served past its TTL. */
  source: 'live' | 'cache' | 'stale';
  fetchedAt: string;
}

/**
 * Cache-through helper with stale-on-error semantics: if the upstream free API
 * is down or rate-limiting us, an expired entry is far more useful to a user
 * than an error page.
 */
export async function cached<T>(
  key: string,
  ttlSeconds: number,
  loader: () => Promise<T>,
): Promise<CachedResult<T>> {
  const existing = readCache<T>(key);
  if (existing && !existing.stale) {
    return { value: existing.value, source: 'cache', fetchedAt: existing.fetchedAt };
  }

  try {
    const value = await loader();
    writeCache(key, value, ttlSeconds);
    return { value, source: 'live', fetchedAt: nowIso() };
  } catch (error) {
    if (existing) {
      return { value: existing.value, source: 'stale', fetchedAt: existing.fetchedAt };
    }
    throw error;
  }
}

/** Drops expired rows; called opportunistically on boot. */
export function pruneCache(): number {
  const result = getDb().prepare('DELETE FROM api_cache WHERE expires_at < ?').run(nowIso());
  return Number(result.changes);
}

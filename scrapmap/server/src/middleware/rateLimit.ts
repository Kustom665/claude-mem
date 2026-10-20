import type { NextFunction, Request, Response } from 'express';
import { env } from '../env.ts';
import { tooManyRequests } from '../lib/errors.ts';

interface Bucket {
  count: number;
  resetAt: number;
}

/**
 * In-memory fixed-window limiter. Deliberately dependency-free and per-process:
 * this app is a single Node process backed by SQLite, so a shared store would
 * be machinery without a purpose. It exists to protect the free upstream APIs
 * and to blunt credential stuffing, not to meter a paid product.
 */
export function rateLimit(options: {
  windowMs: number;
  max: number;
  keyPrefix: string;
  /** Count only failed responses, e.g. for login attempts. */
  skipSuccessful?: boolean;
}) {
  const buckets = new Map<string, Bucket>();
  let lastSweep = Date.now();

  const sweep = (now: number): void => {
    if (now - lastSweep < options.windowMs) return;
    lastSweep = now;
    for (const [key, bucket] of buckets) {
      if (bucket.resetAt <= now) buckets.delete(key);
    }
  };

  return function limiter(req: Request, res: Response, next: NextFunction): void {
    if (!env.rateLimitEnabled) return next();

    const now = Date.now();
    sweep(now);

    const identity = req.user?.id ?? req.ip ?? 'unknown';
    const key = `${options.keyPrefix}:${identity}`;
    const bucket = buckets.get(key);

    if (!bucket || bucket.resetAt <= now) {
      buckets.set(key, { count: 1, resetAt: now + options.windowMs });
      return next();
    }

    if (bucket.count >= options.max) {
      const retryAfter = Math.ceil((bucket.resetAt - now) / 1000);
      res.setHeader('Retry-After', String(retryAfter));
      return next(
        tooManyRequests(`Too many requests. Try again in ${retryAfter}s.`),
      );
    }

    bucket.count += 1;

    if (options.skipSuccessful) {
      res.on('finish', () => {
        if (res.statusCode < 400) {
          const current = buckets.get(key);
          if (current) current.count = Math.max(0, current.count - 1);
        }
      });
    }

    next();
  };
}

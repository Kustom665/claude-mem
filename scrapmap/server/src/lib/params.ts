import type { Request } from 'express';
import { badRequest } from './errors.ts';

/**
 * Reads a route parameter as a string.
 *
 * Express 5 types params as `string | string[] | undefined` because a pattern
 * can repeat or omit a segment. Every route here uses plain single segments, so
 * this narrows once instead of casting at each call site — and turns a
 * malformed path into a 400 rather than a crash deeper in a query.
 */
export function param(req: Request, name: string): string {
  const value = (req.params as Record<string, string | string[] | undefined>)[name];
  if (typeof value === 'string' && value.length > 0) return value;
  if (Array.isArray(value) && typeof value[0] === 'string') return value[0];
  throw badRequest(`Missing "${name}" in the request path.`);
}

import type { NextFunction, Request, Response } from 'express';
import { queryOne } from '../db/index.ts';
import { unauthorized } from '../lib/errors.ts';
import { verifySessionToken } from '../lib/tokens.ts';

export interface AuthUser {
  id: string;
  email: string;
  displayName: string;
  role: 'homeowner' | 'scrapper' | 'both';
  homeLat: number | null;
  homeLon: number | null;
  searchRadiusMiles: number;
}

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      user?: AuthUser;
    }
  }
}

interface UserRow {
  id: string;
  email: string;
  display_name: string;
  role: AuthUser['role'];
  home_lat: number | null;
  home_lon: number | null;
  search_radius_miles: number;
  token_version: number;
  is_active: number;
}

function readToken(req: Request): string | null {
  const header = req.get('authorization');
  if (header?.toLowerCase().startsWith('bearer ')) return header.slice(7).trim();
  const cookie = req.get('cookie');
  if (!cookie) return null;
  for (const part of cookie.split(';')) {
    const [name, ...rest] = part.trim().split('=');
    if (name === 'scrapmap_session') return decodeURIComponent(rest.join('='));
  }
  return null;
}

/** Populates req.user when a valid session token is present; never rejects. */
export function attachUser(req: Request, _res: Response, next: NextFunction): void {
  const token = readToken(req);
  if (!token) return next();

  const payload = verifySessionToken(token);
  if (!payload) return next();

  const row = queryOne<UserRow>(
    `SELECT id, email, display_name, role, home_lat, home_lon,
            search_radius_miles, token_version, is_active
       FROM users WHERE id = ?`,
    [payload.sub],
  );

  // A bumped token_version revokes every token issued before it.
  if (!row || row.is_active !== 1 || row.token_version !== payload.tv) return next();

  req.user = {
    id: row.id,
    email: row.email,
    displayName: row.display_name,
    role: row.role,
    homeLat: row.home_lat,
    homeLon: row.home_lon,
    searchRadiusMiles: row.search_radius_miles,
  };
  next();
}

/** Rejects the request unless a valid session is attached. */
export function requireAuth(req: Request, _res: Response, next: NextFunction): void {
  if (!req.user) return next(unauthorized());
  next();
}

/** Narrowed accessor for handlers that run behind requireAuth. */
export function currentUser(req: Request): AuthUser {
  if (!req.user) throw unauthorized();
  return req.user;
}

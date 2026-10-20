import { Router } from 'express';
import { z } from 'zod';
import { execute, nowIso, queryOne } from '../db/index.ts';
import { env } from '../env.ts';
import { conflict, unauthorized } from '../lib/errors.ts';
import { newId } from '../lib/ids.ts';
import { hashPassword, verifyPassword } from '../lib/password.ts';
import { createSessionToken } from '../lib/tokens.ts';
import { displayName, email, latitude, longitude, password } from '../lib/validate.ts';
import { asyncHandler } from '../middleware/error.ts';
import { currentUser, requireAuth } from '../middleware/auth.ts';
import { rateLimit } from '../middleware/rateLimit.ts';
import { publicUser, type UserRow } from './users.ts';

export const authRouter: Router = Router();

const SESSION_COOKIE = 'scrapmap_session';

function setSessionCookie(res: import('express').Response, token: string): void {
  res.cookie(SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: 'lax',
    secure: env.isProduction,
    maxAge: env.sessionTtlDays * 24 * 60 * 60 * 1000,
    path: '/',
  });
}

const registerSchema = z.object({
  email,
  password,
  displayName,
  role: z.enum(['homeowner', 'scrapper', 'both']).default('both'),
  homeLat: latitude.optional(),
  homeLon: longitude.optional(),
  city: z.string().trim().max(80).optional(),
  region: z.string().trim().max(80).optional(),
  postalCode: z.string().trim().max(16).optional(),
});

authRouter.post(
  '/register',
  rateLimit({ windowMs: 60 * 60 * 1000, max: 10, keyPrefix: 'register' }),
  asyncHandler(async (req, res) => {
    const input = registerSchema.parse(req.body);

    const existing = queryOne<{ id: string }>('SELECT id FROM users WHERE email = ?', [
      input.email,
    ]);
    if (existing) {
      throw conflict('An account already exists for that email. Try signing in.');
    }

    const id = newId('usr');
    const now = nowIso();
    execute(
      `INSERT INTO users (
         id, email, password_hash, display_name, role,
         home_lat, home_lon, city, region, postal_code,
         created_at, updated_at
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        id,
        input.email,
        await hashPassword(input.password),
        input.displayName,
        input.role,
        input.homeLat ?? null,
        input.homeLon ?? null,
        input.city ?? null,
        input.region ?? null,
        input.postalCode ?? null,
        now,
        now,
      ],
    );

    const token = createSessionToken(id, 1);
    setSessionCookie(res, token);
    const row = queryOne<UserRow>('SELECT * FROM users WHERE id = ?', [id]);
    res.status(201).json({ token, user: row ? publicUser(row, true) : null });
  }),
);

const loginSchema = z.object({
  email: z.string().trim().toLowerCase().min(1),
  password: z.string().min(1),
});

authRouter.post(
  '/login',
  rateLimit({ windowMs: 15 * 60 * 1000, max: 12, keyPrefix: 'login', skipSuccessful: true }),
  asyncHandler(async (req, res) => {
    const input = loginSchema.parse(req.body);
    const row = queryOne<UserRow>('SELECT * FROM users WHERE email = ?', [input.email]);

    // Hash even when the user is unknown so a missing account and a wrong
    // password take a comparable amount of time.
    const ok = row
      ? await verifyPassword(input.password, row.password_hash)
      : await verifyPassword(input.password, 'scrypt$16384$8$1$AAAA$AAAA').then(() => false);

    if (!row || !ok || row.is_active !== 1) {
      throw unauthorized('That email and password combination did not work.');
    }

    const token = createSessionToken(row.id, row.token_version);
    setSessionCookie(res, token);
    res.json({ token, user: publicUser(row, true) });
  }),
);

authRouter.post('/logout', (req, res) => {
  res.clearCookie(SESSION_COOKIE, { path: '/' });
  res.json({ ok: true });
});

authRouter.get(
  '/me',
  requireAuth,
  asyncHandler(async (req, res) => {
    const row = queryOne<UserRow>('SELECT * FROM users WHERE id = ?', [currentUser(req).id]);
    if (!row) throw unauthorized();
    res.json({ user: publicUser(row, true) });
  }),
);

const changePasswordSchema = z.object({
  currentPassword: z.string().min(1),
  newPassword: password,
});

authRouter.post(
  '/change-password',
  requireAuth,
  rateLimit({ windowMs: 60 * 60 * 1000, max: 5, keyPrefix: 'change-password' }),
  asyncHandler(async (req, res) => {
    const input = changePasswordSchema.parse(req.body);
    const user = currentUser(req);
    const row = queryOne<UserRow>('SELECT * FROM users WHERE id = ?', [user.id]);
    if (!row) throw unauthorized();

    if (!(await verifyPassword(input.currentPassword, row.password_hash))) {
      throw unauthorized('Your current password did not match.');
    }

    // Bumping token_version invalidates every session, including this one, so
    // we hand back a fresh token rather than logging the user out mid-action.
    const nextVersion = row.token_version + 1;
    execute(
      'UPDATE users SET password_hash = ?, token_version = ?, updated_at = ? WHERE id = ?',
      [await hashPassword(input.newPassword), nextVersion, nowIso(), user.id],
    );

    const token = createSessionToken(user.id, nextVersion);
    setSessionCookie(res, token);
    res.json({ token, ok: true });
  }),
);

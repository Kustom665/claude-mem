import 'server-only';

import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import bcrypt from 'bcryptjs';
import { prisma } from './db';
import type { User } from '@/generated/prisma';

/**
 * Authentication.
 *
 * Sessions are opaque random tokens stored server-side, not stateless JWTs, so
 * a session can actually be revoked — a notary who loses a laptop holding an
 * unexpired journal session needs that to be a button, not a wait.
 *
 * The database stores an HMAC of the token rather than the token itself, keyed
 * with SESSION_SECRET. A leaked database therefore does not yield usable
 * session cookies unless the application secret leaked with it.
 */

const SESSION_COOKIE = 'notary_session';
const SESSION_TTL_DAYS = 30;
const BCRYPT_ROUNDS = 12;

function sessionSecret(): string {
  const secret = process.env.SESSION_SECRET;
  if (!secret || secret.length < 16) {
    if (process.env.NODE_ENV === 'production') {
      throw new Error(
        'SESSION_SECRET must be set to a long random value in production. Generate one with: ' +
          'node -e "console.log(require(\'crypto\').randomBytes(48).toString(\'base64url\'))"',
      );
    }
    return 'insecure-development-secret';
  }
  return secret;
}

function hashToken(token: string): string {
  return createHmac('sha256', sessionSecret()).update(token).digest('hex');
}

export async function hashPassword(plain: string): Promise<string> {
  return bcrypt.hash(plain, BCRYPT_ROUNDS);
}

export async function verifyPassword(plain: string, hash: string): Promise<boolean> {
  return bcrypt.compare(plain, hash);
}

/** Constant-time comparison for non-secret-length-sensitive equality checks. */
export function safeEqual(a: string, b: string): boolean {
  const bufA = Buffer.from(a);
  const bufB = Buffer.from(b);
  if (bufA.length !== bufB.length) return false;
  return timingSafeEqual(bufA, bufB);
}

/**
 * Issue a session and set the cookie.
 *
 * The raw token exists only in the cookie; the row holds its HMAC.
 */
export async function createSession(userId: string, userAgent?: string): Promise<void> {
  const token = randomBytes(32).toString('base64url');
  const expiresAt = new Date(Date.now() + SESSION_TTL_DAYS * 24 * 60 * 60 * 1000);

  await prisma.session.create({
    data: {
      userId,
      tokenHash: hashToken(token),
      expiresAt,
      userAgent: userAgent?.slice(0, 255),
    },
  });

  const store = await cookies();
  store.set(SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    path: '/',
    expires: expiresAt,
  });
}

export async function destroySession(): Promise<void> {
  const store = await cookies();
  const token = store.get(SESSION_COOKIE)?.value;

  if (token) {
    // deleteMany rather than delete: a stale cookie should log out cleanly
    // instead of throwing a record-not-found.
    await prisma.session.deleteMany({ where: { tokenHash: hashToken(token) } });
  }

  store.delete(SESSION_COOKIE);
}

/** Revoke every session for a user — "sign out everywhere". */
export async function destroyAllSessions(userId: string): Promise<number> {
  const result = await prisma.session.deleteMany({ where: { userId } });
  return result.count;
}

/**
 * The signed-in notary, or null.
 *
 * Expired sessions are deleted on read so the table self-cleans without a cron.
 */
export async function getCurrentUser(): Promise<User | null> {
  const store = await cookies();
  const token = store.get(SESSION_COOKIE)?.value;
  if (!token) return null;

  const session = await prisma.session.findUnique({
    where: { tokenHash: hashToken(token) },
    include: { user: true },
  });

  if (!session) return null;

  if (session.expiresAt.getTime() <= Date.now()) {
    await prisma.session.delete({ where: { id: session.id } }).catch(() => {
      // Already gone — nothing to clean up.
    });
    return null;
  }

  return session.user;
}

/**
 * The signed-in notary, or a redirect to sign-in.
 *
 * Every page and action that touches tenant data starts with this call, and
 * every query below it filters on the returned `id`. That is the whole of the
 * multi-tenancy story: there is no shared query path that omits the user scope.
 */
export async function requireUser(): Promise<User> {
  const user = await getCurrentUser();
  if (!user) redirect('/sign-in');
  return user;
}

export { SESSION_COOKIE };

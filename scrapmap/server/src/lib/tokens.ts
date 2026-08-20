import { createHmac, timingSafeEqual } from 'node:crypto';
import { env } from '../env.ts';

export interface SessionPayload {
  /** User id. */
  sub: string;
  /** Issued-at, epoch seconds. */
  iat: number;
  /** Expiry, epoch seconds. */
  exp: number;
  /**
   * Snapshot of the user's token version. Bumping the column invalidates every
   * token already issued, which is how "sign out everywhere" and password
   * changes work without a server-side session table.
   */
  tv: number;
}

const base64url = (input: Buffer | string): string =>
  Buffer.from(input).toString('base64url');

function sign(data: string): string {
  return createHmac('sha256', env.sessionSecret).update(data).digest('base64url');
}

export function createSessionToken(userId: string, tokenVersion: number): string {
  const issuedAt = Math.floor(Date.now() / 1000);
  const payload: SessionPayload = {
    sub: userId,
    iat: issuedAt,
    exp: issuedAt + env.sessionTtlDays * 24 * 60 * 60,
    tv: tokenVersion,
  };
  const body = base64url(JSON.stringify(payload));
  return `${body}.${sign(body)}`;
}

export function verifySessionToken(token: string): SessionPayload | null {
  const dot = token.lastIndexOf('.');
  if (dot <= 0) return null;
  const body = token.slice(0, dot);
  const signature = token.slice(dot + 1);

  const expected = Buffer.from(sign(body));
  const received = Buffer.from(signature);
  if (expected.length !== received.length || !timingSafeEqual(expected, received)) {
    return null;
  }

  try {
    const payload = JSON.parse(Buffer.from(body, 'base64url').toString('utf8')) as SessionPayload;
    if (typeof payload.sub !== 'string' || typeof payload.exp !== 'number') return null;
    if (payload.exp * 1000 < Date.now()) return null;
    return payload;
  } catch {
    return null;
  }
}

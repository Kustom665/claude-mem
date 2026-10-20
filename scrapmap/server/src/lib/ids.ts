import { randomBytes, randomUUID } from 'node:crypto';

const ALPHABET = '0123456789abcdefghjkmnpqrstvwxyz'; // Crockford-ish: no i, l, o, u

/**
 * Short, URL-safe, roughly sortable identifier: a 48-bit timestamp prefix plus
 * random suffix. Sortable ids keep "newest first" queries index-friendly
 * without a separate sequence column.
 */
export function newId(prefix: string): string {
  const now = Date.now();
  let time = '';
  let remaining = now;
  for (let i = 0; i < 10; i += 1) {
    time = ALPHABET[remaining % 32] + time;
    remaining = Math.floor(remaining / 32);
  }
  const bytes = randomBytes(8);
  let random = '';
  for (const byte of bytes) random += ALPHABET[byte % 32];
  return `${prefix}_${time}${random}`;
}

export const newUuid = (): string => randomUUID();

export function slugify(input: string): string {
  const base = input
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60);
  return base || 'group';
}

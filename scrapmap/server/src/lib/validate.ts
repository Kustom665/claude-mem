import { z } from 'zod';
import { isValidLatitude, isValidLongitude } from './geo.ts';

export const latitude = z
  .number()
  .refine(isValidLatitude, { message: 'Latitude must be between -90 and 90.' });

export const longitude = z
  .number()
  .refine(isValidLongitude, { message: 'Longitude must be between -180 and 180.' });

// A format check, not a deliverability check — the only real proof an address
// works is mail arriving at it.
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

export const email = z
  .string()
  .trim()
  .toLowerCase()
  .min(3, 'Enter an email address.')
  .max(254, 'That email address is too long.')
  .refine((value) => EMAIL_PATTERN.test(value), {
    message: 'That does not look like an email address.',
  });

export const password = z
  .string()
  .min(10, 'Use at least 10 characters.')
  .max(200, 'That password is too long.');

export const displayName = z
  .string()
  .trim()
  .min(2, 'Enter a name of at least 2 characters.')
  .max(60, 'Keep it under 60 characters.');

/** Coerces a querystring value to a number, tolerating absent params. */
export const numericQuery = (fallback?: number) =>
  z
    .union([z.string(), z.number()])
    .optional()
    .transform((value) => {
      if (value === undefined || value === '') return fallback;
      const parsed = typeof value === 'number' ? value : Number.parseFloat(value);
      return Number.isFinite(parsed) ? parsed : fallback;
    });

export const boolQuery = z
  .union([z.string(), z.boolean()])
  .optional()
  .transform((value) => {
    if (value === undefined || value === '') return undefined;
    if (typeof value === 'boolean') return value;
    return value === '1' || value.toLowerCase() === 'true';
  });

/** Collapses whitespace and trims; used on every free-text field we store. */
export const cleanText = (max: number, min = 0) =>
  z
    .string()
    .transform((value) => value.replace(/\s+/g, ' ').trim())
    .pipe(z.string().min(min).max(max));

/** Preserves paragraph breaks but strips trailing whitespace per line. */
export const cleanMultiline = (max: number, min = 0) =>
  z
    .string()
    .transform((value) =>
      value
        .split('\n')
        .map((line) => line.replace(/[ \t]+$/g, ''))
        .join('\n')
        .replace(/\n{3,}/g, '\n\n')
        .trim(),
    )
    .pipe(z.string().min(min).max(max));

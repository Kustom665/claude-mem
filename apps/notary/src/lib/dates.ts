/**
 * Date formatting and arithmetic.
 *
 * A notary works in one local jurisdiction, so all display formatting is done
 * in the notary's configured timezone rather than the server's. Storage is
 * always UTC via Prisma DateTime.
 */

const DEFAULT_TIMEZONE = 'America/Los_Angeles';

export function formatDate(
  value: Date | string | null | undefined,
  timeZone: string = DEFAULT_TIMEZONE,
): string {
  const date = coerce(value);
  if (!date) return '—';
  return new Intl.DateTimeFormat('en-US', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    timeZone,
  }).format(date);
}

export function formatDateTime(
  value: Date | string | null | undefined,
  timeZone: string = DEFAULT_TIMEZONE,
): string {
  const date = coerce(value);
  if (!date) return '—';
  return new Intl.DateTimeFormat('en-US', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    timeZone,
  }).format(date);
}

export function formatTime(
  value: Date | string | null | undefined,
  timeZone: string = DEFAULT_TIMEZONE,
): string {
  const date = coerce(value);
  if (!date) return '—';
  return new Intl.DateTimeFormat('en-US', {
    hour: 'numeric',
    minute: '2-digit',
    timeZone,
  }).format(date);
}

export function formatWeekday(
  value: Date | string | null | undefined,
  timeZone: string = DEFAULT_TIMEZONE,
): string {
  const date = coerce(value);
  if (!date) return '—';
  return new Intl.DateTimeFormat('en-US', { weekday: 'long', timeZone }).format(date);
}

/** `Date` → `"2026-08-10"`, for a `<input type="date">` value. */
export function toDateInputValue(
  value: Date | string | null | undefined,
  timeZone: string = DEFAULT_TIMEZONE,
): string {
  const date = coerce(value);
  if (!date) return '';
  const parts = new Intl.DateTimeFormat('en-CA', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    timeZone,
  }).format(date);
  return parts;
}

/** `Date` → `"2026-08-10T14:30"`, for a `<input type="datetime-local">` value. */
export function toDateTimeInputValue(
  value: Date | string | null | undefined,
  timeZone: string = DEFAULT_TIMEZONE,
): string {
  const date = coerce(value);
  if (!date) return '';
  const formatter = new Intl.DateTimeFormat('en-CA', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
    timeZone,
  });
  const parts = Object.fromEntries(
    formatter.formatToParts(date).map((part) => [part.type, part.value]),
  );
  // en-CA renders midnight as "24" in some ICU builds; normalise it.
  const hour = parts.hour === '24' ? '00' : parts.hour;
  return `${parts.year}-${parts.month}-${parts.day}T${hour}:${parts.minute}`;
}

/**
 * Whole days from now until `value`. Negative when the date has passed.
 * Used for commission / E&O / background-check expiry warnings.
 */
export function daysUntil(
  value: Date | string | null | undefined,
  now: Date = new Date(),
): number | null {
  const date = coerce(value);
  if (!date) return null;
  const msPerDay = 24 * 60 * 60 * 1000;
  return Math.ceil((date.getTime() - now.getTime()) / msPerDay);
}

export type ExpiryUrgency = 'expired' | 'critical' | 'warning' | 'ok';

/**
 * Bucket an expiry date for display. The thresholds match how far ahead a
 * notary needs to act: renewals typically take 6-10 weeks, so 90 days is the
 * point where it stops being "later" and becomes "this month".
 */
export function expiryUrgency(
  value: Date | string | null | undefined,
  now: Date = new Date(),
): ExpiryUrgency | null {
  const days = daysUntil(value, now);
  if (days === null) return null;
  if (days < 0) return 'expired';
  if (days <= 30) return 'critical';
  if (days <= 90) return 'warning';
  return 'ok';
}

export function startOfDay(date: Date): Date {
  const copy = new Date(date);
  copy.setHours(0, 0, 0, 0);
  return copy;
}

export function endOfDay(date: Date): Date {
  const copy = new Date(date);
  copy.setHours(23, 59, 59, 999);
  return copy;
}

export function addDays(date: Date, days: number): Date {
  const copy = new Date(date);
  copy.setDate(copy.getDate() + days);
  return copy;
}

export function startOfMonth(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth(), 1);
}

export function endOfMonth(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth() + 1, 0, 23, 59, 59, 999);
}

export function startOfYear(date: Date): Date {
  return new Date(date.getFullYear(), 0, 1);
}

function coerce(value: Date | string | null | undefined): Date | null {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

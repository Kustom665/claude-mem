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

// There are deliberately no startOfDay / startOfMonth / addDays helpers here that
// work in the server's own zone. A notary's "today" and "this month" are in
// their zone, and on a hosted deployment the server's is UTC — use the *InZone
// helpers below, which take the zone explicitly so it cannot be forgotten.

/**
 * How far `timeZone` is ahead of UTC at a given instant, in milliseconds.
 * Negative for the Americas.
 */
export function timeZoneOffsetMs(instant: Date, timeZone: string): number {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat('en-US', {
      timeZone,
      // h23, not hour12:false — some ICU builds render midnight as "24".
      hourCycle: 'h23',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    })
      .formatToParts(instant)
      .map((part) => [part.type, part.value]),
  );

  const wallClockAsUtc = Date.UTC(
    Number(parts.year),
    Number(parts.month) - 1,
    Number(parts.day),
    Number(parts.hour),
    Number(parts.minute),
    Number(parts.second),
  );
  // The formatter drops milliseconds, so compare against the whole second.
  return wallClockAsUtc - (instant.getTime() - instant.getUTCMilliseconds());
}

/**
 * The UTC instant for a wall-clock time in a given time zone.
 *
 * Needed when a calendar date and an hour typed by someone else ("Thursday
 * morning") have to become a stored timestamp in the notary's own zone, which
 * is not the server's.
 */
export function zonedTimeToUtc(
  year: number,
  month: number,
  day: number,
  hour: number,
  minute: number,
  timeZone: string,
): Date {
  const naive = Date.UTC(year, month - 1, day, hour, minute);
  const firstPass = naive - timeZoneOffsetMs(new Date(naive), timeZone);
  // The offset at the corrected instant can differ from the offset at the
  // naive one when the date sits next to a daylight-saving change.
  return new Date(naive - timeZoneOffsetMs(new Date(firstPass), timeZone));
}

/**
 * The tax year as the notary lives it: midnight 1 January to midnight 1 January
 * in their own zone, not the server's. An act at 9 pm on 31 December in New York
 * is 02:00Z on 1 January; bucketing by UTC would book it into the wrong year.
 */
export function yearBoundsInZone(year: number, timeZone: string): { start: Date; end: Date } {
  return {
    start: zonedTimeToUtc(year, 1, 1, 0, 0, timeZone),
    end: zonedTimeToUtc(year + 1, 1, 1, 0, 0, timeZone),
  };
}

/** The calendar year `instant` falls in, in `timeZone`. */
export function yearInZone(instant: Date, timeZone: string): number {
  return Number(
    new Intl.DateTimeFormat('en-US', { timeZone, year: 'numeric' }).format(instant),
  );
}

const DATE_ONLY_INPUT = /^(\d{4})-(\d{2})-(\d{2})$/;
const DATE_TIME_INPUT = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2})(?:\.\d{1,3})?)?$/;

/**
 * The hour a calendar date is anchored to. Noon, because a date typed into a
 * date field has no time or zone, yet the app displays every stored date in the
 * notary's zone. Anchored at UTC midnight it would render as the previous day
 * anywhere west of Greenwich — a commission "expiring 20 Oct" read back as
 * "19 Oct", and drifted a day earlier on every save. Noon in the notary's own
 * zone lands on the right day however the zone later shifts by a few hours.
 */
export const CALENDAR_DATE_ANCHOR_HOUR = 12;

/**
 * Read what a browser date or datetime-local field sent, as an instant.
 *
 * Both are *wall-clock* strings: `2026-10-20` and `2026-10-20T14:30` carry no
 * zone. JavaScript's `new Date()` would read them in the server's zone — UTC on
 * Vercel — so a notary in New York entering 2:30 pm would have 10:30 am
 * recorded against a sealed journal entry. They are the notary's wall clock, so
 * they are read in the notary's zone.
 *
 * Returns null for anything else (an ISO string with an explicit zone, an
 * impossible date such as 31 February, free text), leaving the caller to
 * handle it as before.
 */
export function interpretWallClock(value: string, timeZone: string): Date | null {
  const dateTime = DATE_TIME_INPUT.exec(value);
  const dateOnly = dateTime ? null : DATE_ONLY_INPUT.exec(value);
  const match = dateTime ?? dateOnly;
  if (!match) return null;

  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const hour = dateTime ? Number(match[4]) : CALENDAR_DATE_ANCHOR_HOUR;
  const minute = dateTime ? Number(match[5]) : 0;
  const second = dateTime && match[6] ? Number(match[6]) : 0;

  // Reject what the calendar does not have, rather than rolling it forward.
  const probe = new Date(Date.UTC(year, month - 1, day, hour, minute, second));
  if (
    probe.getUTCFullYear() !== year ||
    probe.getUTCMonth() !== month - 1 ||
    probe.getUTCDate() !== day ||
    hour > 23 ||
    minute > 59 ||
    second > 59
  ) {
    return null;
  }

  const instant = zonedTimeToUtc(year, month, day, hour, minute, timeZone);
  return new Date(instant.getTime() + second * 1000);
}

/** The last instant of the calendar day that `instant` falls on in `timeZone`. */
export function endOfDayInZone(instant: Date, timeZone: string): Date {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat('en-US', {
      timeZone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    })
      .formatToParts(instant)
      .map((part) => [part.type, part.value]),
  );

  const lastMinute = zonedTimeToUtc(
    Number(parts.year),
    Number(parts.month),
    Number(parts.day),
    23,
    59,
    timeZone,
  );
  return new Date(lastMinute.getTime() + 59_999);
}

const HOUR_MS = 60 * 60 * 1000;

/**
 * The next whole hour strictly after `instant`, by the clock rather than by the
 * server's calendar. Every zone this app is used in has whole-hour offsets, so a
 * UTC hour boundary is a wall-clock hour boundary for the notary too.
 */
export function nextWholeHour(instant: Date): Date {
  return new Date((Math.floor(instant.getTime() / HOUR_MS) + 1) * HOUR_MS);
}

/** `instant` itself if it is exactly on the hour, otherwise the next whole hour. */
export function ceilToHour(instant: Date): Date {
  return new Date(Math.ceil(instant.getTime() / HOUR_MS) * HOUR_MS);
}

/** Calendar year, month (1–12) and day of `instant` as a wall clock in `timeZone` reads them. */
export function calendarPartsInZone(
  instant: Date,
  timeZone: string,
): { year: number; month: number; day: number } {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat('en-US', {
      timeZone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    })
      .formatToParts(instant)
      .map((part) => [part.type, part.value]),
  );
  return { year: Number(parts.year), month: Number(parts.month), day: Number(parts.day) };
}

/**
 * Midnight at the start of the calendar day `instant` falls on in `timeZone`.
 *
 * "Today" for a notary in New York begins at 04:00Z or 05:00Z, not at the
 * server's midnight; "the next 14 days" and "this month" are measured from it.
 */
export function startOfDayInZone(instant: Date, timeZone: string): Date {
  const { year, month, day } = calendarPartsInZone(instant, timeZone);
  return zonedTimeToUtc(year, month, day, 0, 0, timeZone);
}

/** Midnight at the start of the calendar month `instant` falls in, in `timeZone`. */
export function startOfMonthInZone(instant: Date, timeZone: string): Date {
  const { year, month } = calendarPartsInZone(instant, timeZone);
  return zonedTimeToUtc(year, month, 1, 0, 0, timeZone);
}

/**
 * The calendar day `days` after the one `instant` falls on in `timeZone`,
 * anchored at noon like every other stored calendar date. Counting calendar days
 * rather than 24-hour spans keeps "in 7 days" on the same wall-clock date across
 * a daylight-saving change.
 */
export function addCalendarDaysInZone(instant: Date, days: number, timeZone: string): Date {
  const { year, month, day } = calendarPartsInZone(instant, timeZone);
  // Date.UTC carries a day count past the end of a month into the next one.
  const shifted = new Date(Date.UTC(year, month - 1, day + days));
  return zonedTimeToUtc(
    shifted.getUTCFullYear(),
    shifted.getUTCMonth() + 1,
    shifted.getUTCDate(),
    CALENDAR_DATE_ANCHOR_HOUR,
    0,
    timeZone,
  );
}

function coerce(value: Date | string | null | undefined): Date | null {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

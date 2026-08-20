import { DAY_KEYS, type BusinessHours, type DayKey } from "@/types/database";

export const DAY_LABELS: Record<DayKey, string> = {
  mon: "Monday",
  tue: "Tuesday",
  wed: "Wednesday",
  thu: "Thursday",
  fri: "Friday",
  sat: "Saturday",
  sun: "Sunday",
};

export const DEFAULT_HOURS: BusinessHours = {
  mon: { closed: false, open: "09:00", close: "17:00" },
  tue: { closed: false, open: "09:00", close: "17:00" },
  wed: { closed: false, open: "09:00", close: "17:00" },
  thu: { closed: false, open: "09:00", close: "17:00" },
  fri: { closed: false, open: "09:00", close: "17:00" },
  sat: { closed: true, open: "09:00", close: "17:00" },
  sun: { closed: true, open: "09:00", close: "17:00" },
};

export const TIME_RE = /^([01]\d|2[0-3]):([0-5]\d)$/;

export function isValidTimeZone(timeZone: string): boolean {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone });
    return true;
  } catch {
    return false;
  }
}

/** Every IANA zone the runtime knows, with a small fallback for old runtimes. */
export function supportedTimeZones(): string[] {
  const supported = Intl.supportedValuesOf?.("timeZone");
  if (supported && supported.length > 0) return [...supported];

  return [
    "America/New_York",
    "America/Chicago",
    "America/Denver",
    "America/Phoenix",
    "America/Los_Angeles",
    "America/Anchorage",
    "Pacific/Honolulu",
    "UTC",
  ];
}

type ZonedNow = { day: DayKey; time: string };

const WEEKDAY_TO_KEY: Record<string, DayKey> = {
  Mon: "mon",
  Tue: "tue",
  Wed: "wed",
  Thu: "thu",
  Fri: "fri",
  Sat: "sat",
  Sun: "sun",
};

function zonedNow(timeZone: string, at: Date): ZonedNow | null {
  try {
    const parts = new Intl.DateTimeFormat("en-US", {
      timeZone,
      weekday: "short",
      hour: "2-digit",
      minute: "2-digit",
      hourCycle: "h23",
    }).formatToParts(at);

    const lookup = (type: Intl.DateTimeFormatPartTypes) =>
      parts.find((part) => part.type === type)?.value ?? "";

    const day = WEEKDAY_TO_KEY[lookup("weekday")];
    if (!day) return null;

    return { day, time: `${lookup("hour")}:${lookup("minute")}` };
  } catch {
    return null;
  }
}

function previousDay(day: DayKey): DayKey {
  const index = DAY_KEYS.indexOf(day);
  return DAY_KEYS[(index + DAY_KEYS.length - 1) % DAY_KEYS.length];
}

/**
 * Zero-padded 24-hour strings compare correctly as strings, so no date math is
 * needed. A close time earlier than the open time means the day runs past
 * midnight, and the tail of that window is credited to the following day.
 */
export function isOpenAt(
  hours: BusinessHours,
  timeZone: string,
  at: Date = new Date(),
): boolean | null {
  const now = zonedNow(timeZone, at);
  if (!now) return null;

  const today = hours[now.day];
  if (today && !today.closed) {
    if (today.close > today.open) {
      if (now.time >= today.open && now.time < today.close) return true;
    } else if (today.close < today.open) {
      if (now.time >= today.open) return true;
    }
  }

  const yesterday = hours[previousDay(now.day)];
  if (
    yesterday &&
    !yesterday.closed &&
    yesterday.close < yesterday.open &&
    now.time < yesterday.close
  ) {
    return true;
  }

  return false;
}

/** "9:00 AM – 5:00 PM" / "Closed" */
export function formatDayHours(hours: BusinessHours, day: DayKey): string {
  const entry = hours[day];
  if (!entry || entry.closed) return "Closed";
  return `${formatTime(entry.open)} – ${formatTime(entry.close)}`;
}

export function formatTime(value: string): string {
  const match = TIME_RE.exec(value);
  if (!match) return value;

  const hour = Number(match[1]);
  const minute = match[2];
  const suffix = hour < 12 ? "AM" : "PM";
  const display = hour % 12 === 0 ? 12 : hour % 12;

  return `${display}:${minute} ${suffix}`;
}

/** Collapses a week into "Mon–Fri, Sat" style summary text for the table. */
export function summarizeHours(hours: BusinessHours): string {
  const openDays = DAY_KEYS.filter((day) => !hours[day]?.closed);
  if (openDays.length === 0) return "Closed all week";
  if (openDays.length === 7) return "Open every day";

  return openDays
    .map((day) => DAY_LABELS[day].slice(0, 3))
    .join(", ");
}

import { endOfDayInZone, interpretWallClock, startOfDayInZone } from './dates';

/**
 * A "from" and "to" typed into two date fields, as the instants that bound them.
 *
 * Both are calendar days on the notary's own wall clock, so "to 31 October"
 * includes an act performed at 9 pm Eastern on the 31st — which is already
 * 1 November in UTC, the zone a hosted server runs in. Reading the day in the
 * server's zone would quietly drop the last evening of every range from an
 * exported or printed journal.
 *
 * A value that is not a real `yyyy-mm-dd` date is ignored rather than turned
 * into an invalid Date, which the database layer would reject with a server
 * error; a hand-edited URL should show the unfiltered list, not a crash.
 */
export function dateRangeBounds(
  from: string | null | undefined,
  to: string | null | undefined,
  timeZone: string,
): { gte?: Date; lte?: Date } | undefined {
  const start = from ? interpretWallClock(from.trim(), timeZone) : null;
  const end = to ? interpretWallClock(to.trim(), timeZone) : null;
  if (!start && !end) return undefined;

  const bounds: { gte?: Date; lte?: Date } = {};
  if (start) bounds.gte = startOfDayInZone(start, timeZone);
  if (end) bounds.lte = endOfDayInZone(end, timeZone);
  return bounds;
}

/** A `yyyy-mm-dd` value read as a calendar day (noon in the zone), for display. */
export function calendarDayOf(value: string | null | undefined, timeZone: string): Date | null {
  return value ? interpretWallClock(value.trim(), timeZone) : null;
}

import { describe, expect, it } from 'vitest';
import { dateRangeBounds, calendarDayOf } from '@/lib/date-range';
import {
  addCalendarDaysInZone,
  calendarPartsInZone,
  ceilToHour,
  endOfDayInZone,
  nextWholeHour,
  interpretWallClock,
  startOfDayInZone,
  startOfMonthInZone,
  toDateInputValue,
  toDateTimeInputValue,
} from '@/lib/dates';
import { formDataToObject, mileageSchema } from '@/lib/validation';

/**
 * Every expectation here is an absolute instant, so the suite means the same
 * thing whatever zone the machine running it is in — which is the property under
 * test. (CI runs it under UTC; a developer in New York and one in Berlin must see
 * the same result.)
 */

const ZONES = [
  'America/New_York',
  'America/Chicago',
  'America/Denver',
  'America/Los_Angeles',
  'America/Anchorage',
  'Pacific/Honolulu',
  'Europe/Berlin',
  'UTC',
] as const;

describe('interpretWallClock — datetime-local', () => {
  it('reads the notary’s clock, not the server’s', () => {
    // The bug: a New York notary enters 2:30 pm. Read in a UTC server's zone that
    // is 14:30Z — 10:30 am in New York — and it was sealed into the journal that way.
    expect(interpretWallClock('2026-10-20T14:30', 'America/New_York')?.toISOString()).toBe(
      '2026-10-20T18:30:00.000Z',
    );
    expect(interpretWallClock('2026-10-20T14:30', 'America/Los_Angeles')?.toISOString()).toBe(
      '2026-10-20T21:30:00.000Z',
    );
    expect(interpretWallClock('2026-10-20T14:30', 'Europe/Berlin')?.toISOString()).toBe(
      '2026-10-20T12:30:00.000Z',
    );
    expect(interpretWallClock('2026-10-20T14:30', 'UTC')?.toISOString()).toBe(
      '2026-10-20T14:30:00.000Z',
    );
  });

  it('handles winter time', () => {
    expect(interpretWallClock('2026-12-01T09:00', 'America/New_York')?.toISOString()).toBe(
      '2026-12-01T14:00:00.000Z',
    );
  });

  it('accepts seconds', () => {
    expect(interpretWallClock('2026-10-20T14:30:15', 'America/New_York')?.toISOString()).toBe(
      '2026-10-20T18:30:15.000Z',
    );
  });

  it('round-trips with the form’s own formatter, in every zone', () => {
    for (const zone of ZONES) {
      for (const typed of ['2026-01-15T00:00', '2026-07-04T23:59', '2026-10-20T14:30', '2026-12-31T23:30']) {
        const instant = interpretWallClock(typed, zone);
        expect(instant, `${zone} ${typed}`).not.toBeNull();
        expect(toDateTimeInputValue(instant, zone), `${zone} ${typed}`).toBe(typed);
      }
    }
  });

  it('survives the daylight-saving changes', () => {
    // US spring forward: 02:00 → 03:00 on 8 March 2026.
    expect(interpretWallClock('2026-03-08T01:30', 'America/New_York')?.toISOString()).toBe(
      '2026-03-08T06:30:00.000Z',
    );
    expect(interpretWallClock('2026-03-08T03:30', 'America/New_York')?.toISOString()).toBe(
      '2026-03-08T07:30:00.000Z',
    );
    // US fall back: 02:00 → 01:00 on 1 November 2026.
    expect(interpretWallClock('2026-11-01T00:30', 'America/New_York')?.toISOString()).toBe(
      '2026-11-01T04:30:00.000Z',
    );
    expect(interpretWallClock('2026-11-01T03:30', 'America/New_York')?.toISOString()).toBe(
      '2026-11-01T08:30:00.000Z',
    );
  });

  it('still yields a valid time for a clock time that does not exist or happens twice', () => {
    // 02:30 on spring-forward day never happens; 01:30 on fall-back day happens twice.
    // Neither may throw or return garbage; either real instant is acceptable.
    const gap = interpretWallClock('2026-03-08T02:30', 'America/New_York');
    expect(gap && !Number.isNaN(gap.getTime())).toBe(true);

    const overlap = interpretWallClock('2026-11-01T01:30', 'America/New_York');
    expect(['2026-11-01T05:30:00.000Z', '2026-11-01T06:30:00.000Z']).toContain(overlap?.toISOString());
  });
});

describe('interpretWallClock — date', () => {
  it('anchors a calendar date at noon in the notary’s zone', () => {
    expect(interpretWallClock('2026-10-20', 'America/New_York')?.toISOString()).toBe(
      '2026-10-20T16:00:00.000Z',
    );
    expect(interpretWallClock('2026-10-20', 'America/Los_Angeles')?.toISOString()).toBe(
      '2026-10-20T19:00:00.000Z',
    );
  });

  it('reads back as the same calendar day in every zone', () => {
    for (const zone of ZONES) {
      for (const typed of ['2026-01-01', '2026-03-08', '2026-10-20', '2026-11-01', '2026-12-31']) {
        const stored = interpretWallClock(typed, zone);
        expect(toDateInputValue(stored, zone), `${zone} ${typed}`).toBe(typed);
      }
    }
  });

  it('explains why the old approach drifted a day early', () => {
    // This is what `new Date('2026-10-20')` stored: midnight UTC. Shown in the
    // notary's zone that is the evening of the 19th — a commission "expiring
    // 20 October" read back as the 19th, and moved a day earlier on every save.
    const oldStored = new Date('2026-10-20');
    expect(toDateInputValue(oldStored, 'America/New_York')).toBe('2026-10-19');
    expect(toDateInputValue(oldStored, 'America/Los_Angeles')).toBe('2026-10-19');
    expect(toDateInputValue(oldStored, 'UTC')).toBe('2026-10-20');
  });
});

describe('interpretWallClock — rejects what it cannot read', () => {
  it('returns null for impossible dates rather than rolling them forward', () => {
    for (const bad of ['2026-02-31', '2026-13-01', '2026-00-10', '2026-04-31', '2026-10-32']) {
      expect(interpretWallClock(bad, 'America/New_York'), bad).toBeNull();
    }
    expect(interpretWallClock('2026-02-29', 'UTC')).toBeNull(); // 2026 is not a leap year
    expect(interpretWallClock('2028-02-29', 'UTC')?.toISOString()).toBe('2028-02-29T12:00:00.000Z');
  });

  it('returns null for impossible times', () => {
    for (const bad of ['2026-10-20T24:00', '2026-10-20T14:60', '2026-10-20T25:00', '2026-10-20T14:30:61']) {
      expect(interpretWallClock(bad, 'America/New_York'), bad).toBeNull();
    }
  });

  it('leaves anything else alone for the caller to deal with', () => {
    for (const other of ['', 'tomorrow', '10/20/2026', '2026-10-20T14:30:00Z', '2026-10-20T14:30:00-04:00', '2026-10-20 14:30']) {
      expect(interpretWallClock(other, 'America/New_York'), other).toBeNull();
    }
  });
});

describe('endOfDayInZone', () => {
  it('is the last millisecond of the notary’s calendar day', () => {
    // Noon on 20 Oct in New York is 16:00Z; the day ends at 23:59:59.999 EDT = 03:59:59.999Z.
    expect(endOfDayInZone(new Date('2026-10-20T16:00:00Z'), 'America/New_York').toISOString()).toBe(
      '2026-10-21T03:59:59.999Z',
    );
    expect(endOfDayInZone(new Date('2026-10-20T19:00:00Z'), 'America/Los_Angeles').toISOString()).toBe(
      '2026-10-21T06:59:59.999Z',
    );
    expect(endOfDayInZone(new Date('2026-12-01T17:00:00Z'), 'America/New_York').toISOString()).toBe(
      '2026-12-02T04:59:59.999Z',
    );
  });

  it('puts a 3 pm act on the expiry day inside a commission that expires that day', () => {
    const expiry = interpretWallClock('2026-10-20', 'America/New_York') as Date; // noon
    const actAt3pm = interpretWallClock('2026-10-20T15:00', 'America/New_York') as Date;
    const actNextMorning = interpretWallClock('2026-10-21T00:05', 'America/New_York') as Date;

    const lastValidInstant = endOfDayInZone(expiry, 'America/New_York').getTime();
    expect(actAt3pm.getTime()).toBeLessThanOrEqual(lastValidInstant);
    expect(actNextMorning.getTime()).toBeGreaterThan(lastValidInstant);
  });

  it('follows the zone across the day boundary', () => {
    // 03:00Z on the 21st is still the evening of the 20th in New York.
    expect(endOfDayInZone(new Date('2026-10-21T03:00:00Z'), 'America/New_York').toISOString()).toBe(
      '2026-10-21T03:59:59.999Z',
    );
  });
});

describe('calendar helpers in the notary’s zone', () => {
  const NY = 'America/New_York';

  it('reads the calendar day as the notary’s wall clock does', () => {
    // 01:00Z on 22 Oct is 21:00 on 21 Oct in New York.
    const evening = new Date('2026-10-22T01:00:00Z');
    expect(calendarPartsInZone(evening, NY)).toEqual({ year: 2026, month: 10, day: 21 });
    expect(calendarPartsInZone(evening, 'UTC')).toEqual({ year: 2026, month: 10, day: 22 });
  });

  it('starts "today" at the notary’s midnight', () => {
    // Midnight on 21 Oct in New York (EDT, UTC−4) is 04:00Z.
    expect(startOfDayInZone(new Date('2026-10-22T01:00:00Z'), NY).toISOString()).toBe(
      '2026-10-21T04:00:00.000Z',
    );
    // After the clocks go back (EST, UTC−5) the same midnight is 05:00Z.
    expect(startOfDayInZone(new Date('2026-11-02T15:00:00Z'), NY).toISOString()).toBe(
      '2026-11-02T05:00:00.000Z',
    );
  });

  it('starts "this month" at the notary’s midnight on the 1st', () => {
    // 02:00Z on 1 Nov is still the evening of 31 Oct in New York, so it is October.
    expect(startOfMonthInZone(new Date('2026-11-01T02:00:00Z'), NY).toISOString()).toBe(
      '2026-10-01T04:00:00.000Z',
    );
    expect(startOfMonthInZone(new Date('2026-11-01T06:00:00Z'), NY).toISOString()).toBe(
      '2026-11-01T04:00:00.000Z',
    );
  });

  it('adds calendar days, anchored at noon, across month ends and clock changes', () => {
    const shifted = (from: string, days: number) =>
      toDateTimeInputValue(addCalendarDaysInZone(new Date(from), days, NY), NY);

    // Across the end of a month, and the change from summer to winter time.
    expect(shifted('2026-10-28T14:00:00Z', 7)).toBe('2026-11-04T12:00');
    // Across the end of a year.
    expect(shifted('2026-12-30T14:00:00Z', 5)).toBe('2027-01-04T12:00');
    // Backwards, across the end of February.
    expect(shifted('2026-03-02T14:00:00Z', -3)).toBe('2026-02-27T12:00');
  });

  it('agrees with the date a notary would have typed', () => {
    const typed = interpretWallClock('2026-11-04', NY) as Date;
    const computed = addCalendarDaysInZone(new Date('2026-10-28T14:00:00Z'), 7, NY);
    expect(computed.toISOString()).toBe(typed.toISOString());
  });

  it('gives the same calendar answer in every zone', () => {
    for (const zone of ZONES) {
      const start = interpretWallClock('2026-10-28', zone) as Date;
      const later = addCalendarDaysInZone(start, 7, zone);
      expect(toDateInputValue(later, zone)).toBe('2026-11-04');
    }
  });
});

describe('whole-hour helpers', () => {
  it('rounds up by the clock, whatever zone the server is in', () => {
    expect(nextWholeHour(new Date('2026-10-20T14:30:00Z')).toISOString()).toBe('2026-10-20T15:00:00.000Z');
    expect(nextWholeHour(new Date('2026-10-20T15:00:00Z')).toISOString()).toBe('2026-10-20T16:00:00.000Z');
    expect(ceilToHour(new Date('2026-10-20T14:30:00Z')).toISOString()).toBe('2026-10-20T15:00:00.000Z');
    expect(ceilToHour(new Date('2026-10-20T15:00:00Z')).toISOString()).toBe('2026-10-20T15:00:00.000Z');
    expect(ceilToHour(new Date('2026-10-20T15:00:00.001Z')).toISOString()).toBe('2026-10-20T16:00:00.000Z');
  });
});

describe('dateRangeBounds — a from/to filter on the notary’s calendar', () => {
  const NY = 'America/New_York';

  it('includes the whole of both end days', () => {
    const range = dateRangeBounds('2026-10-01', '2026-10-31', NY);
    // 1 Oct 00:00 EDT and the last millisecond of 31 Oct EDT.
    expect(range?.gte?.toISOString()).toBe('2026-10-01T04:00:00.000Z');
    expect(range?.lte?.toISOString()).toBe('2026-11-01T03:59:59.999Z');
  });

  it('keeps a 9 pm act on the last day inside the range', () => {
    const range = dateRangeBounds('2026-10-01', '2026-10-31', NY);
    const ninePmOn31st = interpretWallClock('2026-10-31T21:00', NY) as Date; // 01:00Z on 1 Nov
    expect(ninePmOn31st.getTime()).toBeLessThanOrEqual(range?.lte?.getTime() ?? 0);
    const tenPmOn30Sep = interpretWallClock('2026-09-30T22:00', NY) as Date;
    expect(tenPmOn30Sep.getTime()).toBeLessThan(range?.gte?.getTime() ?? 0);
  });

  it('takes either end on its own', () => {
    expect(dateRangeBounds('2026-10-01', '', NY)?.lte).toBeUndefined();
    expect(dateRangeBounds('', '2026-10-31', NY)?.gte).toBeUndefined();
    expect(dateRangeBounds(null, undefined, NY)).toBeUndefined();
  });

  it('ignores anything that is not a real date instead of producing an invalid one', () => {
    expect(dateRangeBounds('not-a-date', '2026-02-31', NY)).toBeUndefined();
    expect(dateRangeBounds("2026-10-01'; drop table", '', NY)).toBeUndefined();
    const range = dateRangeBounds('garbage', '2026-10-31', NY);
    expect(range?.gte).toBeUndefined();
    expect(Number.isNaN(range?.lte?.getTime())).toBe(false);
  });

  it('labels a day the way the notary typed it', () => {
    expect(toDateInputValue(calendarDayOf('2026-10-01', NY), NY)).toBe('2026-10-01');
    expect(calendarDayOf('', NY)).toBeNull();
    expect(calendarDayOf('nonsense', NY)).toBeNull();
  });
});

describe('formDataToObject with a time zone', () => {
  function form(entries: Record<string, string>): FormData {
    const data = new FormData();
    for (const [key, value] of Object.entries(entries)) data.set(key, value);
    return data;
  }

  it('converts named date fields and nothing else', () => {
    const result = formDataToObject(
      form({
        performedAt: '2026-10-20T14:30',
        documentDate: '2026-10-20',
        // Look like dates, are not: must stay exactly as typed.
        loanNumber: '2026-10-20',
        notes: '2026-10-20T14:30',
        signerName: '2026-10-20',
      }),
      'America/New_York',
    );
    expect(result.performedAt).toBe('2026-10-20T18:30:00.000Z');
    expect(result.documentDate).toBe('2026-10-20T16:00:00.000Z');
    expect(result.loanNumber).toBe('2026-10-20');
    expect(result.notes).toBe('2026-10-20T14:30');
    expect(result.signerName).toBe('2026-10-20');
  });

  it('leaves a value it cannot read as typed, so validation can reject it', () => {
    const result = formDataToObject(form({ performedAt: 'next tuesday', date: '2026-02-31' }), 'UTC');
    expect(result.performedAt).toBe('next tuesday');
    expect(result.date).toBe('2026-02-31');
  });

  it('passes everything through untouched without a zone', () => {
    const result = formDataToObject(form({ performedAt: '2026-10-20T14:30', date: '2026-10-20' }));
    expect(result.performedAt).toBe('2026-10-20T14:30');
    expect(result.date).toBe('2026-10-20');
  });

  it('feeds the validators an unambiguous instant', () => {
    const parsed = mileageSchema.safeParse(
      formDataToObject(
        form({ date: '2026-10-20', miles: '12', ratePerMileCents: '72.5', purpose: 'Signing' }),
        'America/New_York',
      ),
    );
    expect(parsed.success).toBe(true);
    if (parsed.success) expect(parsed.data.date.toISOString()).toBe('2026-10-20T16:00:00.000Z');
  });

  it('trims whitespace around a date before reading it', () => {
    const result = formDataToObject(form({ date: ' 2026-10-20 ' }), 'America/New_York');
    expect(result.date).toBe('2026-10-20T16:00:00.000Z');
  });
});

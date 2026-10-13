import { describe, expect, it } from 'vitest';
import {
  clientTypeForCategory,
  DUE_SOON_DAYS,
  emptyPipelineCounts,
  followUpState,
  statusTransitionDates,
  suggestFollowUp,
} from '@/lib/pipeline';
import { PIPELINE_STATUSES } from '@/lib/domain';
import { interpretWallClock, toDateInputValue, toDateTimeInputValue } from '@/lib/dates';

// A Pennsylvania notary. The tests assert absolute instants and calendar days in
// this zone, so they hold whatever zone the process itself happens to run in.
const ZONE = 'America/New_York';

// 08:00 on 13 October in New York.
const NOW = new Date('2026-10-13T12:00:00Z');

/** A follow-up date as the app stores one: noon on that calendar day, in the notary's zone. */
const day = (isoDate: string): Date => {
  const instant = interpretWallClock(isoDate, ZONE);
  if (!instant) throw new Error(`bad test date ${isoDate}`);
  return instant;
};

describe('followUpState', () => {
  it('has nothing to say without a date', () => {
    expect(followUpState(null, 'APPLIED', ZONE, NOW)).toBe('NONE');
  });

  it('flags a past date on an open status as overdue', () => {
    expect(followUpState(day('2026-10-12'), 'APPLIED', ZONE, NOW)).toBe('OVERDUE');
    expect(followUpState(day('2026-09-13'), 'ONBOARDING', ZONE, NOW)).toBe('OVERDUE');
  });

  it('treats today as due soon, not overdue', () => {
    expect(followUpState(day('2026-10-13'), 'APPLIED', ZONE, NOW)).toBe('DUE_SOON');
  });

  it('draws the due-soon line at the documented window', () => {
    expect(DUE_SOON_DAYS).toBe(3);
    expect(followUpState(day('2026-10-16'), 'APPLIED', ZONE, NOW)).toBe('DUE_SOON');
    expect(followUpState(day('2026-10-17'), 'APPLIED', ZONE, NOW)).toBe('SCHEDULED');
  });

  it('never nags about sources with nothing left to chase', () => {
    // A stale date on a declined or active source must not surface as overdue.
    for (const status of ['ACTIVE', 'DECLINED', 'DORMANT']) {
      expect(followUpState(day('2026-10-03'), status, ZONE, NOW)).toBe('NONE');
    }
  });

  it('keeps chasing researching, applied, onboarding and approved sources', () => {
    for (const status of ['RESEARCHING', 'APPLIED', 'ONBOARDING', 'APPROVED']) {
      expect(followUpState(day('2026-10-12'), status, ZONE, NOW)).toBe('OVERDUE');
    }
  });

  it('reads "today" on the notary’s clock, not the server’s', () => {
    // 21:00 on 21 October in New York is already 22 October in UTC. A follow-up
    // set for the 21st is due today for the notary, not overdue.
    const evening = new Date('2026-10-22T01:00:00Z');
    expect(followUpState(day('2026-10-21'), 'APPLIED', ZONE, evening)).toBe('DUE_SOON');
    expect(followUpState(day('2026-10-20'), 'APPLIED', ZONE, evening)).toBe('OVERDUE');

    // The same instant in a zone where it is already the 22nd is a different answer.
    expect(followUpState(day('2026-10-21'), 'APPLIED', 'UTC', evening)).toBe('OVERDUE');
  });

  it('counts the due-soon window in calendar days across a daylight-saving change', () => {
    // Clocks go back in New York on 1 November 2026.
    const beforeChange = new Date('2026-10-30T16:00:00Z');
    expect(followUpState(day('2026-11-02'), 'APPLIED', ZONE, beforeChange)).toBe('DUE_SOON');
    expect(followUpState(day('2026-11-03'), 'APPLIED', ZONE, beforeChange)).toBe('SCHEDULED');
  });
});

describe('suggestFollowUp', () => {
  /** The suggestion as the notary will see it: calendar day and wall-clock time. */
  const suggested = (status: string, from: Date = NOW) => {
    const result = suggestFollowUp(status, ZONE, from);
    return result ? toDateTimeInputValue(result, ZONE) : null;
  };

  it('waits a week after applying', () => {
    expect(suggested('APPLIED')).toBe('2026-10-20T12:00');
  });

  it('checks back sooner during onboarding', () => {
    expect(suggested('ONBOARDING')).toBe('2026-10-18T12:00');
  });

  it('reminds an approved vendor after a fortnight of silence', () => {
    expect(suggested('APPROVED')).toBe('2026-10-27T12:00');
  });

  it('suggests nothing where chasing is pointless', () => {
    for (const status of ['RESEARCHING', 'ACTIVE', 'DECLINED', 'DORMANT']) {
      expect(suggestFollowUp(status, ZONE, NOW)).toBeNull();
    }
  });

  it('lands on the same wall-clock date across a daylight-saving change', () => {
    // 28 October + 7 days crosses the 1 November change; 24h × 7 would be an hour out.
    expect(suggested('APPLIED', new Date('2026-10-28T12:00:00Z'))).toBe('2026-11-04T12:00');
  });

  it('counts from the notary’s date, not the server’s', () => {
    // 21:00 on 21 October in New York is 22 October in UTC.
    const evening = new Date('2026-10-22T01:00:00Z');
    expect(suggested('APPLIED', evening)).toBe('2026-10-28T12:00');
    expect(toDateInputValue(suggestFollowUp('APPLIED', ZONE, evening), ZONE)).toBe('2026-10-28');
  });
});

describe('statusTransitionDates', () => {
  const empty = { appliedOn: null, approvedOn: null };

  it('stamps the application date the first time a source reaches applied', () => {
    const result = statusTransitionDates('RESEARCHING', 'APPLIED', empty, NOW);
    expect(result.appliedOn).toEqual(NOW);
    expect(result.approvedOn).toBeNull();
  });

  it('does not restamp when the status is saved unchanged', () => {
    const result = statusTransitionDates('APPLIED', 'APPLIED', empty, NOW);
    expect(result.appliedOn).toBeNull();
  });

  it('stamps both dates when a source jumps straight to approved', () => {
    const result = statusTransitionDates('RESEARCHING', 'APPROVED', empty, NOW);
    expect(result.appliedOn).toEqual(NOW);
    expect(result.approvedOn).toEqual(NOW);
  });

  it('never overwrites a date the notary already recorded', () => {
    const earlier = new Date('2026-09-01T00:00:00Z');
    const result = statusTransitionDates(
      'APPLIED',
      'APPROVED',
      { appliedOn: earlier, approvedOn: null },
      NOW,
    );
    expect(result.appliedOn).toEqual(earlier);
    expect(result.approvedOn).toEqual(NOW);
  });

  it('records nothing for a source that is only being researched or has been declined', () => {
    expect(statusTransitionDates(null, 'RESEARCHING', empty, NOW)).toEqual(empty);
    expect(statusTransitionDates('APPLIED', 'DECLINED', empty, NOW)).toEqual(empty);
  });
});

describe('clientTypeForCategory', () => {
  it('maps source categories onto the nearest client type', () => {
    expect(clientTypeForCategory('SIGNING_SERVICE')).toBe('SIGNING_SERVICE');
    expect(clientTypeForCategory('RON_PLATFORM')).toBe('SIGNING_SERVICE');
    expect(clientTypeForCategory('TITLE_ESCROW')).toBe('TITLE_COMPANY');
    expect(clientTypeForCategory('LENDER_BANK')).toBe('LENDER');
    expect(clientTypeForCategory('LAW_FIRM')).toBe('LAW_FIRM');
    expect(clientTypeForCategory('REAL_ESTATE')).toBe('REAL_ESTATE_AGENT');
  });

  it('falls back to other for anything without a close match', () => {
    expect(clientTypeForCategory('HEALTHCARE_SENIOR')).toBe('OTHER');
    expect(clientTypeForCategory('not-a-category')).toBe('OTHER');
  });
});

describe('emptyPipelineCounts', () => {
  it('has a zero for every status, so a tally never sees undefined', () => {
    const counts = emptyPipelineCounts();
    expect(Object.keys(counts).sort()).toEqual([...PIPELINE_STATUSES].sort());
    expect(Object.values(counts).every((count) => count === 0)).toBe(true);
  });
});

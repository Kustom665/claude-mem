import {
  PIPELINE_OPEN_STATUSES,
  type PipelineStatus,
  type SourceCategory,
  type ClientType,
} from './domain';
import { addCalendarDaysInZone, toDateInputValue } from './dates';

/**
 * The notary's pipeline of work sources — the rules that keep it honest.
 *
 * Applying to a signing service and hearing nothing back is the normal case,
 * not the exception, so the single most valuable thing a pipeline does is
 * remember to ask again. Everything here serves that.
 *
 * A follow-up is a calendar date, and "today" is the notary's, so each function
 * that reasons about days takes the notary's IANA zone. On a hosted deployment
 * the server runs in UTC, which is hours ahead of a Pennsylvania evening.
 */

export type FollowUpState = 'NONE' | 'OVERDUE' | 'DUE_SOON' | 'SCHEDULED';

/** Follow-ups inside this many days are surfaced as "due soon". */
export const DUE_SOON_DAYS = 3;

/**
 * Where a follow-up date stands.
 *
 * Only statuses still waiting on an answer carry a follow-up: a declined or
 * active source has nothing left to chase, so a stale date on one must not
 * nag.
 */
export function followUpState(
  nextFollowUpOn: Date | null,
  status: string,
  timeZone: string,
  now: Date = new Date(),
): FollowUpState {
  if (!nextFollowUpOn) return 'NONE';
  if (!PIPELINE_OPEN_STATUSES.has(status as PipelineStatus)) return 'NONE';

  // yyyy-mm-dd strings in the notary's zone: they sort the way the days do.
  const today = toDateInputValue(now, timeZone);
  const due = toDateInputValue(nextFollowUpOn, timeZone);
  if (due < today) return 'OVERDUE';

  const soonest = toDateInputValue(addCalendarDaysInZone(now, DUE_SOON_DAYS, timeZone), timeZone);
  if (due <= soonest) return 'DUE_SOON';
  return 'SCHEDULED';
}

/**
 * Days to wait before chasing, by status. The gaps reflect how this work
 * behaves: a fresh application deserves a week before a nudge, onboarding moves
 * faster and stalls on paperwork, and an approved vendor who has not been sent a
 * job in two weeks is worth a polite reminder that they exist.
 */
const FOLLOW_UP_GAP_DAYS: Readonly<Record<string, number>> = {
  APPLIED: 7,
  ONBOARDING: 5,
  APPROVED: 14,
};

/**
 * A sensible next follow-up for a status, counted from `from` and anchored at
 * noon on the calendar day like any other date the notary would have typed.
 * Returns null where chasing would be pointless.
 */
export function suggestFollowUp(
  status: string,
  timeZone: string,
  from: Date = new Date(),
): Date | null {
  const gap = FOLLOW_UP_GAP_DAYS[status];
  return gap === undefined ? null : addCalendarDaysInZone(from, gap, timeZone);
}

/**
 * Dates that should be stamped automatically when a status changes, so the
 * notary does not have to remember to record them.
 */
export function statusTransitionDates(
  previousStatus: string | null,
  nextStatus: string,
  existing: { appliedOn: Date | null; approvedOn: Date | null },
  now: Date = new Date(),
): { appliedOn: Date | null; approvedOn: Date | null } {
  let { appliedOn, approvedOn } = existing;

  const reachedApplied = ['APPLIED', 'ONBOARDING', 'APPROVED', 'ACTIVE'].includes(nextStatus);
  if (reachedApplied && !appliedOn && previousStatus !== nextStatus) appliedOn = now;

  const reachedApproved = ['APPROVED', 'ACTIVE'].includes(nextStatus);
  if (reachedApproved && !approvedOn && previousStatus !== nextStatus) approvedOn = now;

  return { appliedOn, approvedOn };
}

/** The Client type that best matches a source category, for "convert to client". */
export function clientTypeForCategory(category: string): ClientType {
  switch (category as SourceCategory) {
    case 'SIGNING_SERVICE':
    case 'RON_PLATFORM':
      return 'SIGNING_SERVICE';
    case 'TITLE_ESCROW':
      return 'TITLE_COMPANY';
    case 'LENDER_BANK':
      return 'LENDER';
    case 'LAW_FIRM':
      return 'LAW_FIRM';
    case 'REAL_ESTATE':
      return 'REAL_ESTATE_AGENT';
    default:
      return 'OTHER';
  }
}

export type PipelineCounts = Record<PipelineStatus, number>;

export function emptyPipelineCounts(): PipelineCounts {
  return {
    RESEARCHING: 0,
    APPLIED: 0,
    ONBOARDING: 0,
    APPROVED: 0,
    ACTIVE: 0,
    DECLINED: 0,
    DORMANT: 0,
  };
}

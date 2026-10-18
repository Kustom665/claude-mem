import 'server-only';

import { prisma } from './db';
import { PIPELINE_OPEN_STATUSES } from './domain';
import { followUpState } from './pipeline';

/**
 * What is waiting on the notary in Find Work. Shown as badges on the tabs and
 * as a card on the dashboard, so an unanswered lead is visible without having
 * to go looking for it.
 */
export type FindWorkCounts = {
  /** Requests nobody has looked at yet. */
  newRequests: number;
  /** Pipeline follow-ups that are overdue or due within a few days. */
  followUpsDue: number;
  /** Follow-ups that are already past their date. */
  followUpsOverdue: number;
};

export async function findWorkCounts(
  userId: string,
  timeZone: string,
  now: Date = new Date(),
): Promise<FindWorkCounts> {
  const [newRequests, chasing] = await Promise.all([
    prisma.workRequest.count({ where: { userId, status: 'NEW' } }),
    prisma.sourceApplication.findMany({
      where: {
        userId,
        status: { in: [...PIPELINE_OPEN_STATUSES] },
        nextFollowUpOn: { not: null },
      },
      select: { status: true, nextFollowUpOn: true },
    }),
  ]);

  let followUpsDue = 0;
  let followUpsOverdue = 0;
  for (const entry of chasing) {
    const state = followUpState(entry.nextFollowUpOn, entry.status, timeZone, now);
    if (state === 'OVERDUE') {
      followUpsOverdue += 1;
      followUpsDue += 1;
    } else if (state === 'DUE_SOON') {
      followUpsDue += 1;
    }
  }

  return { newRequests, followUpsDue, followUpsOverdue };
}

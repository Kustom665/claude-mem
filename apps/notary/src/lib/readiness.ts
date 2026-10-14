import { daysUntil } from './dates';
import {
  REQUIREMENTS,
  type RequirementDef,
  type RequirementKey,
} from './requirements';

/**
 * Am I ready to apply?
 *
 * Judges a notary against a work source's requirements using the credentials
 * already recorded in the app. The honest part is that automatic requirements
 * are computed, never ticked: an expired policy shows as expired.
 */

/** The slice of a notary's record that readiness depends on. */
export type NotaryCredentials = {
  commissionExpiresOn: Date | null;
  isSigningAgent: boolean;
  backgroundCheckExpiresOn: Date | null;
  eoExpiresOn: Date | null;
  eoCoverageCents: number | null;
};

/** Cover of this much or more satisfies the common higher E&O floor. */
export const EO_HIGH_FLOOR_CENTS = 10_000_000;

/** Renewing takes weeks; within this window a credential is a problem in waiting. */
export const EXPIRING_SOON_DAYS = 45;

export type RequirementStatus =
  /** An automatic requirement that holds. */
  | 'MET'
  /** Holds today but lapses soon — worth renewing before applying. */
  | 'EXPIRING'
  /** An automatic requirement with no record at all. */
  | 'MISSING'
  /** An automatic requirement that has lapsed. */
  | 'EXPIRED'
  /** A manual requirement the notary has ticked. */
  | 'DONE'
  /** A manual requirement not yet ticked. */
  | 'TODO';

export type RequirementResult = {
  key: RequirementKey;
  label: string;
  kind: RequirementDef['kind'];
  status: RequirementStatus;
  /** True when the requirement currently counts toward readiness. */
  satisfied: boolean;
  /** One sentence on where the notary stands. */
  note: string;
  fix: string;
  fixHref: string | null;
};

function describeExpiry(days: number): string {
  if (days === 0) return 'expires today';
  if (days === 1) return 'expires tomorrow';
  return `expires in ${days} days`;
}

/** Shared by the three credentials that are simply "a date that must be in the future". */
function checkDated(
  def: RequirementDef,
  expiresOn: Date | null,
  now: Date,
  noun: string,
): RequirementResult {
  const base = { key: def.key, label: def.label, kind: def.kind, fix: def.fix, fixHref: def.fixHref };

  if (!expiresOn) {
    return { ...base, status: 'MISSING', satisfied: false, note: `No ${noun} recorded.` };
  }

  const days = daysUntil(expiresOn, now);
  if (days === null || days < 0) {
    return { ...base, status: 'EXPIRED', satisfied: false, note: `Your ${noun} has expired.` };
  }
  if (days <= EXPIRING_SOON_DAYS) {
    return {
      ...base,
      status: 'EXPIRING',
      satisfied: true,
      note: `Your ${noun} ${describeExpiry(days)} — renew it before you apply.`,
    };
  }
  return { ...base, status: 'MET', satisfied: true, note: `Your ${noun} is current.` };
}

export function checkRequirement(
  key: RequirementKey,
  credentials: NotaryCredentials,
  manualDone: ReadonlySet<string>,
  now: Date = new Date(),
): RequirementResult {
  const def = REQUIREMENTS[key];
  const base = { key: def.key, label: def.label, kind: def.kind, fix: def.fix, fixHref: def.fixHref };

  switch (key) {
    case 'COMMISSION_ACTIVE':
      return checkDated(def, credentials.commissionExpiresOn, now, 'commission');

    case 'BACKGROUND_CHECK':
      return checkDated(def, credentials.backgroundCheckExpiresOn, now, 'background check');

    case 'EO_ACTIVE':
      return checkDated(def, credentials.eoExpiresOn, now, 'E&O policy');

    case 'EO_100K': {
      const active = checkDated(def, credentials.eoExpiresOn, now, 'E&O policy');
      if (!active.satisfied) return active;
      const cover = credentials.eoCoverageCents ?? 0;
      if (cover < EO_HIGH_FLOOR_CENTS) {
        return {
          ...base,
          status: 'MISSING',
          satisfied: false,
          note:
            cover > 0
              ? `Your E&O limit is $${(cover / 100).toLocaleString('en-US')}, below $100,000.`
              : 'No E&O coverage amount recorded.',
        };
      }
      return active;
    }

    case 'SIGNING_AGENT_PROFILE':
      return credentials.isSigningAgent
        ? { ...base, status: 'MET', satisfied: true, note: 'Your profile is set up for loan signings.' }
        : { ...base, status: 'MISSING', satisfied: false, note: 'Your profile is not marked as a loan signing agent.' };

    default: {
      const done = manualDone.has(key);
      return {
        ...base,
        status: done ? 'DONE' : 'TODO',
        satisfied: done,
        note: done ? 'You have marked this as done.' : 'Not yet marked as done.',
      };
    }
  }
}

export type SourceRequirements = { requirements: readonly RequirementKey[] };

export type Readiness = {
  total: number;
  satisfied: number;
  /** Whole percent; 100 for a source that asks for nothing. */
  percent: number;
  ready: boolean;
  results: RequirementResult[];
  /** Everything still standing between the notary and an application. */
  blockers: RequirementResult[];
  /** Satisfied but lapsing soon. */
  expiring: RequirementResult[];
  /** Manual items counted on the notary's word rather than verified. */
  takenOnTrust: number;
};

export function assessReadiness(
  source: SourceRequirements,
  credentials: NotaryCredentials,
  manualDone: ReadonlySet<string>,
  now: Date = new Date(),
): Readiness {
  const results = source.requirements.map((key) => checkRequirement(key, credentials, manualDone, now));
  const satisfied = results.filter((result) => result.satisfied).length;
  const total = results.length;

  return {
    total,
    satisfied,
    percent: total === 0 ? 100 : Math.round((satisfied / total) * 100),
    ready: satisfied === total,
    results,
    blockers: results.filter((result) => !result.satisfied),
    expiring: results.filter((result) => result.status === 'EXPIRING'),
    takenOnTrust: results.filter((result) => result.kind === 'MANUAL' && result.satisfied).length,
  };
}

export type UnlockSummary = {
  key: RequirementKey;
  label: string;
  kind: RequirementDef['kind'];
  fix: string;
  fixHref: string | null;
  /** Sources that list this requirement and are not yet satisfied by it. */
  blocks: number;
  /** Sources for which this is the only thing missing. */
  soleBlocker: number;
};

/**
 * Which single fix opens the most doors?
 *
 * For every requirement the notary lacks, count how many sources it is holding
 * back — and how many it is holding back *alone*, because clearing a sole
 * blocker converts a "not yet" into "apply today". Ranked by sole blockers,
 * then total blocks, so the first line is the most useful next action.
 */
export function rankUnlocks(
  sources: ReadonlyArray<SourceRequirements>,
  credentials: NotaryCredentials,
  manualDone: ReadonlySet<string>,
  now: Date = new Date(),
): UnlockSummary[] {
  const tally = new Map<RequirementKey, UnlockSummary>();

  for (const source of sources) {
    const readiness = assessReadiness(source, credentials, manualDone, now);
    for (const blocker of readiness.blockers) {
      const existing = tally.get(blocker.key) ?? {
        key: blocker.key,
        label: blocker.label,
        kind: blocker.kind,
        fix: blocker.fix,
        fixHref: blocker.fixHref,
        blocks: 0,
        soleBlocker: 0,
      };
      existing.blocks += 1;
      if (readiness.blockers.length === 1) existing.soleBlocker += 1;
      tally.set(blocker.key, existing);
    }
  }

  return [...tally.values()].sort(
    (a, b) => b.soleBlocker - a.soleBlocker || b.blocks - a.blocks || a.label.localeCompare(b.label),
  );
}

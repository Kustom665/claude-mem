import type { ActType } from './domain';

/**
 * Jurisdiction reference data and compliance rules.
 *
 * IMPORTANT: everything here is reference data with a capture date, not legal
 * advice. Notary law changes every legislative session — Pennsylvania's
 * implementing regulations took effect 28 March 2026 and Utah made journals
 * mandatory in the same cycle. The UI labels these values "state maximum
 * (verify)" and shows REFERENCE_CAPTURED_ON alongside them, so stale data is
 * visible rather than silently trusted.
 *
 * Per-item sources are recorded below and collected in docs/RESEARCH.md.
 */

export const REFERENCE_CAPTURED_ON = '2026-08-10';

/** The state the product is built and tuned for first. */
export const DEFAULT_STATE = 'PA';

// ---------------------------------------------------------------------------
// Journal law
// ---------------------------------------------------------------------------

export type JournalRequirement = 'REQUIRED' | 'RECOMMENDED' | 'REQUIRED_FOR_SOME_ACTS';

export type StateJournalRule = {
  requirement: JournalRequirement;
  /** Whether an electronic journal is expressly permitted. */
  electronicJournalPermitted: boolean | null;
  note: string;
  source: string | null;
};

export const STATE_JOURNAL_RULES: Readonly<Record<string, StateJournalRule>> = {
  PA: {
    requirement: 'REQUIRED',
    electronicJournalPermitted: true,
    note:
      'RULONA requires every Pennsylvania notary to keep a journal of notarial acts. The journal ' +
      'may be tangible (bound, consecutively numbered pages) or electronic, provided the electronic ' +
      'journal is tamper-evident. Each entry records the date and time, the type of act, a ' +
      'description of the document, the signer’s name and address, the identification method, and ' +
      'the fee charged.',
    source: 'https://www.pa.gov/agencies/dos/programs/notaries/notary-regulations-changes',
  },
  CA: {
    requirement: 'REQUIRED',
    electronicJournalPermitted: false,
    note:
      'Government Code §8206 requires a sequential, bound journal with numbered pages. Only one ' +
      'active journal at a time, kept in a locked area under your direct and exclusive control. A ' +
      'thumbprint is required for real-property documents and powers of attorney.',
    source: 'https://notary.cdn.sos.ca.gov/forms/notary-handbook-current.pdf',
  },
  TX: {
    requirement: 'REQUIRED',
    electronicJournalPermitted: true,
    note: 'Texas requires a record book of all notarial acts.',
    source: null,
  },
  NV: {
    requirement: 'REQUIRED',
    electronicJournalPermitted: true,
    note: 'Nevada requires a sequential journal of all notarial acts.',
    source: null,
  },
  AZ: {
    requirement: 'REQUIRED',
    electronicJournalPermitted: false,
    note:
      'Arizona requires a single active paper journal, except that a second journal may be kept ' +
      'for entries involving public records.',
    source: null,
  },
  UT: {
    requirement: 'REQUIRED',
    electronicJournalPermitted: true,
    note: 'Utah made journals mandatory under SB 139 (2026 session). Confirm the effective date.',
    source: 'https://le.utah.gov/Session/2026/bills/introduced/SB0139.pdf',
  },
  OH: {
    requirement: 'REQUIRED_FOR_SOME_ACTS',
    electronicJournalPermitted: true,
    note:
      'Ohio requires a journal only for recording protests, but a full journal remains best practice.',
    source: null,
  },
  HI: {
    requirement: 'REQUIRED',
    electronicJournalPermitted: false,
    note: 'Hawaii requires a journal of all notarial acts.',
    source: null,
  },
};

export function journalRuleFor(state: string | null | undefined): StateJournalRule {
  if (!state) return defaultJournalRule();
  return STATE_JOURNAL_RULES[state.toUpperCase()] ?? defaultJournalRule();
}

function defaultJournalRule(): StateJournalRule {
  return {
    requirement: 'RECOMMENDED',
    electronicJournalPermitted: null,
    note:
      'Your state may not mandate a journal, but commissioning officials and every major notary ' +
      'association treat one as best practice — it is your only evidence of what happened if a ' +
      'notarization is later challenged.',
    source: null,
  };
}

// ---------------------------------------------------------------------------
// What may and may not be recorded in the journal
//
// This is the rule set most likely to get a notary in trouble, because it runs
// in opposite directions in different states: California *requires* a
// thumbprint for real-property documents, while Pennsylvania *prohibits*
// recording biometrics in the journal at all.
// ---------------------------------------------------------------------------

export type JournalFieldRules = {
  /** Biometrics (thumbprints) may not be recorded in the journal. */
  prohibitsBiometrics: boolean;
  /** Only the last four digits of an identification number may be recorded. */
  idNumberLastFourOnly: boolean;
  /** Date of birth may not be recorded. */
  prohibitsDateOfBirth: boolean;
  /** Any person may demand to inspect the journal. */
  publicInspectionRight: boolean;
  note: string | null;
  source: string | null;
};

const DEFAULT_FIELD_RULES: JournalFieldRules = {
  prohibitsBiometrics: false,
  idNumberLastFourOnly: true,
  prohibitsDateOfBirth: true,
  publicInspectionRight: false,
  note:
    'No state requires you to record a full identification number. Storing only the last four ' +
    'digits is the safe default everywhere and is what this journal records.',
  source: null,
};

export const STATE_JOURNAL_FIELD_RULES: Readonly<Record<string, JournalFieldRules>> = {
  PA: {
    prohibitsBiometrics: true,
    idNumberLastFourOnly: true,
    prohibitsDateOfBirth: true,
    publicInspectionRight: true,
    note:
      'Effective 28 March 2026, a Pennsylvania journal may not contain personal identifiers: no ' +
      'Social Security number, no full driver’s licence or ID number, no date or place of birth, ' +
      'no mother’s maiden name, and no biometrics. Only the last four digits of an ID may be ' +
      'recorded. A notary must also permit any person who asks — orally or in writing — to inspect ' +
      'the journal in the notary’s presence.',
    source: 'https://www.pa.gov/agencies/dos/programs/notaries/notary-regulations-changes',
  },
  CA: {
    prohibitsBiometrics: false,
    idNumberLastFourOnly: true,
    prohibitsDateOfBirth: true,
    publicInspectionRight: false,
    note:
      'California requires the signer’s right thumbprint for powers of attorney and documents ' +
      'affecting real property (Gov. Code §8206).',
    source: 'https://notary.cdn.sos.ca.gov/forms/notary-handbook-current.pdf',
  },
};

export function journalFieldRulesFor(state: string | null | undefined): JournalFieldRules {
  if (!state) return DEFAULT_FIELD_RULES;
  return STATE_JOURNAL_FIELD_RULES[state.toUpperCase()] ?? DEFAULT_FIELD_RULES;
}

// ---------------------------------------------------------------------------
// Thumbprint rules
// ---------------------------------------------------------------------------

/**
 * Document descriptions that trigger California's thumbprint requirement:
 * a power of attorney, deed, quitclaim deed, deed of trust, or any other
 * document affecting real property (Gov. Code §8206(a)).
 */
const THUMBPRINT_TRIGGER_PATTERNS: readonly RegExp[] = [
  /\bpower\s+of\s+attorney\b/i,
  /\bdeed\s+of\s+trust\b/i,
  /\bquit\s?claim\s+deed\b/i,
  /\bgrant\s+deed\b/i,
  /\bwarranty\s+deed\b/i,
  /\binterspousal\s+transfer\b/i,
  /\bsecurity\s+deed\b/i,
  /\bmortgage\b/i,
  /\bdeed\b/i,
];

/**
 * Documents that look like deeds but are carved out of §8206. Checked first,
 * because "deed of reconveyance" also matches /\bdeed\b/.
 */
const THUMBPRINT_EXEMPT_PATTERNS: readonly RegExp[] = [
  /\bdeed\s+of\s+reconveyance\b/i,
  /\breconveyance\b/i,
  /\btrustee'?s?\s+deed\b/i,
];

export type ThumbprintAssessment = {
  /** The state affirmatively requires a thumbprint for this document. */
  required: boolean;
  /** The state prohibits recording a thumbprint in the journal at all. */
  prohibited: boolean;
  /** Matched a trigger pattern but is statutorily exempt. */
  exempt: boolean;
  /** Affects real property, but the state neither requires nor forbids a print. */
  recommended: boolean;
  reason: string | null;
};

/**
 * Decide how a thumbprint should be handled for a given document and state.
 *
 * Three outcomes matter: California requires one for real-property documents,
 * Pennsylvania forbids recording one at all, and most states are silent.
 */
export function assessThumbprint(
  documentType: string,
  documentDescription: string | null | undefined,
  commissionState: string | null | undefined,
): ThumbprintAssessment {
  const state = (commissionState ?? '').toUpperCase();
  const fieldRules = journalFieldRulesFor(state);

  if (fieldRules.prohibitsBiometrics) {
    return {
      required: false,
      prohibited: true,
      exempt: false,
      recommended: false,
      reason:
        state === 'PA'
          ? 'Pennsylvania prohibits recording biometrics in the notary journal (effective 28 March 2026).'
          : 'Your state prohibits recording biometrics in the notary journal.',
    };
  }

  const haystack = `${documentType} ${documentDescription ?? ''}`;

  if (THUMBPRINT_EXEMPT_PATTERNS.some((pattern) => pattern.test(haystack))) {
    return {
      required: false,
      prohibited: false,
      exempt: true,
      recommended: false,
      reason:
        'Deeds of reconveyance and trustees’ deeds from foreclosure are exempt from the ' +
        'California thumbprint requirement.',
    };
  }

  if (!THUMBPRINT_TRIGGER_PATTERNS.some((pattern) => pattern.test(haystack))) {
    return { required: false, prohibited: false, exempt: false, recommended: false, reason: null };
  }

  if (state === 'CA') {
    return {
      required: true,
      prohibited: false,
      exempt: false,
      recommended: false,
      reason:
        'California Government Code §8206 requires the signer’s right thumbprint in the journal ' +
        'for powers of attorney and documents affecting real property.',
    };
  }

  return {
    required: false,
    prohibited: false,
    exempt: false,
    recommended: true,
    reason:
      'This document affects real property. A thumbprint is not required in your state, but it is ' +
      'strong evidence if the notarization is ever challenged.',
  };
}

// ---------------------------------------------------------------------------
// Statutory fee maximums
// ---------------------------------------------------------------------------

export type StateFeeReference = {
  state: string;
  /** Maximum for a standard acknowledgment, in cents. */
  acknowledgmentMaxCents: number | null;
  juratMaxCents: number | null;
  /**
   * Additional amount permitted for an electronic or remote notarization. Some
   * states express this as a surcharge on top of the base fee (Pennsylvania),
   * others as an absolute cap (Florida) — `ronIsSurcharge` disambiguates.
   */
  ronMaxCents: number | null;
  ronIsSurcharge: boolean;
  basis: 'PER_SIGNATURE' | 'PER_ACT';
  /** State compels advance disclosure of fees to the client. */
  requiresFeeDisclosure: boolean;
  note: string;
  source: string;
};

/**
 * Deliberately partial. A wrong number here is worse than no number, because a
 * notary who overcharges commits a violation — states without an entry show
 * "verify with your commissioning authority" instead of a guess.
 */
export const STATE_FEE_REFERENCE: Readonly<Record<string, StateFeeReference>> = {
  PA: {
    state: 'PA',
    acknowledgmentMaxCents: 500,
    juratMaxCents: 500,
    ronMaxCents: 2000,
    ronIsSurcharge: true,
    basis: 'PER_ACT',
    requiresFeeDisclosure: true,
    note:
      'Since 28 March 2026 the ceiling is set by 4 Pa. Code §167.3: a table running from $2 to $5 ' +
      'per act, with $5 the maximum for acknowledgments, oaths, verifications, witnessing ' +
      'signatures and certifying copies. Electronic and remote notaries may add up to $20 per act. ' +
      'Travel, copies, postage and platform fees are non-notarial charges that must be itemised and ' +
      'agreed in advance.',
    source: 'https://www.pa.gov/agencies/dos/programs/notaries/notary-public-fees',
  },
  CA: {
    state: 'CA',
    acknowledgmentMaxCents: 1500,
    juratMaxCents: 1500,
    ronMaxCents: null,
    ronIsSurcharge: false,
    basis: 'PER_SIGNATURE',
    requiresFeeDisclosure: false,
    note: 'California caps acknowledgments and jurats at $15 per signature.',
    source: 'https://notary.cdn.sos.ca.gov/forms/notary-handbook-current.pdf',
  },
  TX: {
    state: 'TX',
    acknowledgmentMaxCents: 600,
    juratMaxCents: 600,
    ronMaxCents: 2500,
    ronIsSurcharge: false,
    basis: 'PER_SIGNATURE',
    requiresFeeDisclosure: false,
    note: 'Texas caps the statutory notarial fee at $6 per signature for in-person acts.',
    source: 'https://legalcostcalculator.org/notary-fees-by-state/',
  },
  FL: {
    state: 'FL',
    acknowledgmentMaxCents: 1000,
    juratMaxCents: 1000,
    ronMaxCents: 2500,
    ronIsSurcharge: false,
    basis: 'PER_ACT',
    requiresFeeDisclosure: false,
    note:
      'Florida allows $10 for acknowledgments and oaths, and up to $25 for remote online notarization.',
    source: 'https://legalcostcalculator.org/notary-fees-by-state/',
  },
};

/** States that compel a notary to disclose fees before performing the act. */
export const FEE_DISCLOSURE_STATES: ReadonlySet<string> = new Set(['PA', 'MI', 'NC']);

export function feeReferenceFor(state: string | null | undefined): StateFeeReference | null {
  if (!state) return null;
  return STATE_FEE_REFERENCE[state.toUpperCase()] ?? null;
}

export function requiresFeeDisclosure(state: string | null | undefined): boolean {
  return FEE_DISCLOSURE_STATES.has((state ?? '').toUpperCase());
}

export type FeeCheck = {
  overMax: boolean;
  maxCents: number;
  note: string;
  source: string;
};

/**
 * Check a notarial fee against the state maximum.
 *
 * Returns null when there is no reference data, so callers can distinguish
 * "within the cap" from "we don't know the cap" and say so honestly.
 */
export function checkFeeAgainstStateMax(
  feeCents: number,
  actType: ActType,
  state: string | null | undefined,
  isRemote = false,
): FeeCheck | null {
  const reference = feeReferenceFor(state);
  if (!reference) return null;

  const baseMax =
    actType === 'JURAT' || actType === 'OATH_OR_AFFIRMATION'
      ? reference.juratMaxCents
      : reference.acknowledgmentMaxCents;

  if (baseMax === null) return null;

  let maxCents = baseMax;
  if (isRemote && reference.ronMaxCents !== null) {
    maxCents = reference.ronIsSurcharge ? baseMax + reference.ronMaxCents : reference.ronMaxCents;
  }

  return {
    overMax: feeCents > maxCents,
    maxCents,
    note: reference.note,
    source: reference.source,
  };
}

// ---------------------------------------------------------------------------
// IRS standard mileage rates
// ---------------------------------------------------------------------------

type MileageRatePeriod = {
  /** Inclusive ISO start date. */
  from: string;
  /** Exclusive ISO end date, or null for the current open period. */
  until: string | null;
  ratePerMileCents: number;
};

/**
 * IRS business standard mileage rates.
 *
 * 2026 has two: the IRS set 72.5¢ effective 1 January and raised it to 76¢
 * effective 1 July in response to fuel costs. Mileage either side of that split
 * must use different rates — exactly the detail that gets a deduction
 * disallowed on audit.
 */
const MILEAGE_RATES: readonly MileageRatePeriod[] = [
  { from: '2024-01-01', until: '2025-01-01', ratePerMileCents: 67 },
  { from: '2025-01-01', until: '2026-01-01', ratePerMileCents: 70 },
  { from: '2026-01-01', until: '2026-07-01', ratePerMileCents: 72.5 },
  { from: '2026-07-01', until: null, ratePerMileCents: 76 },
];

/**
 * The IRS rate in effect on a given date, in cents per mile.
 *
 * May be fractional (72.5¢ in the first half of 2026); callers round the final
 * dollar amount, never the rate.
 */
export function irsMileageRateCents(date: Date = new Date()): number {
  const iso = date.toISOString().slice(0, 10);
  for (let i = MILEAGE_RATES.length - 1; i >= 0; i -= 1) {
    const period = MILEAGE_RATES[i];
    if (iso >= period.from && (period.until === null || iso < period.until)) {
      return period.ratePerMileCents;
    }
  }
  return MILEAGE_RATES[MILEAGE_RATES.length - 1].ratePerMileCents;
}

export const MILEAGE_RATE_NOTE =
  'IRS business standard mileage: 72.5¢/mi for 1 Jan – 30 Jun 2026, 76¢/mi from 1 Jul 2026.';

export const MILEAGE_RATE_SOURCE =
  'https://www.irs.gov/newsroom/irs-sets-2026-business-standard-mileage-rate-at-725-cents-per-mile-up-25-cents';

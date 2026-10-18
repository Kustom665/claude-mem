/**
 * What a work source asks of a notary before it will send work.
 *
 * Two kinds, and the difference is the point:
 *
 *   AUTO    checked against the credentials the notary already keeps in
 *           Settings → Commission & compliance. These cannot be ticked falsely:
 *           an expired E&O policy is not a met requirement, whatever the
 *           notary would like to believe at 11 pm before an application.
 *
 *   MANUAL  things the app cannot see — a certification held with a third
 *           party, a W-9 in a folder. The notary ticks these by hand, and the
 *           readiness figure says plainly which ones it is taking on trust.
 */

export const REQUIREMENT_KEYS = [
  'COMMISSION_ACTIVE',
  'SIGNING_AGENT_PROFILE',
  'BACKGROUND_CHECK',
  'EO_ACTIVE',
  'EO_100K',
  'NNA_CERTIFIED',
  'PRINTER_SCANNER',
  'HEADSHOT_BIO',
  'W9',
  'EXPERIENCE_SUMMARY',
  'BUSINESS_PROFILE',
  'ELECTRONIC_NOTARY_APPROVAL',
] as const;
export type RequirementKey = (typeof REQUIREMENT_KEYS)[number];

export type RequirementDef = {
  key: RequirementKey;
  label: string;
  kind: 'AUTO' | 'MANUAL';
  /** What the requirement means in practice. */
  detail: string;
  /** What to do when it is not met. */
  fix: string;
  /** Where in the app the fix happens, for AUTO requirements. */
  fixHref: string | null;
};

export const REQUIREMENTS: Readonly<Record<RequirementKey, RequirementDef>> = {
  COMMISSION_ACTIVE: {
    key: 'COMMISSION_ACTIVE',
    label: 'Active notary commission',
    kind: 'AUTO',
    detail: 'Your commission is in force. A notarial act on an expired commission is void.',
    fix: 'Record your commission number and expiry date.',
    fixHref: '/settings/commission',
  },
  SIGNING_AGENT_PROFILE: {
    key: 'SIGNING_AGENT_PROFILE',
    label: 'Loan signing agent',
    kind: 'AUTO',
    detail: 'Your profile is marked as a loan signing agent.',
    fix: 'Tick “I work as a loan signing agent” in your commission settings.',
    fixHref: '/settings/commission',
  },
  BACKGROUND_CHECK: {
    key: 'BACKGROUND_CHECK',
    label: 'Current background check',
    kind: 'AUTO',
    detail:
      'A background screening that has not lapsed. Most signing services re-check yearly and ' +
      'will not onboard you on an expired one.',
    fix: 'Order or renew a background check, then record its expiry date.',
    fixHref: '/settings/commission',
  },
  EO_ACTIVE: {
    key: 'EO_ACTIVE',
    label: 'Active errors & omissions insurance',
    kind: 'AUTO',
    detail: 'An E&O policy that has not expired.',
    fix: 'Buy or renew E&O coverage, then record the policy and expiry date.',
    fixHref: '/settings/commission',
  },
  EO_100K: {
    key: 'EO_100K',
    label: 'E&O coverage of $100,000 or more',
    kind: 'AUTO',
    detail: 'Some lenders and signing services set a higher floor than the common $25,000.',
    fix: 'Raise your E&O limit to at least $100,000 and update the amount.',
    fixHref: '/settings/commission',
  },
  NNA_CERTIFIED: {
    key: 'NNA_CERTIFIED',
    label: 'Notary Signing Agent certification',
    kind: 'MANUAL',
    detail:
      'A current signing-agent certification from the National Notary Association (the exam ' +
      'and background screening it bundles).',
    fix: 'Complete the certification, then tick this once you hold it.',
    fixHref: null,
  },
  PRINTER_SCANNER: {
    key: 'PRINTER_SCANNER',
    label: 'Duplex laser printer and scanner',
    kind: 'MANUAL',
    detail: 'Loan packages are printed double-sided and scanned back, often the same day.',
    fix: 'Set up a reliable duplex printer and a scanner that produces searchable PDFs.',
    fixHref: null,
  },
  HEADSHOT_BIO: {
    key: 'HEADSHOT_BIO',
    label: 'Professional headshot and short bio',
    kind: 'MANUAL',
    detail: 'Onboarding portals and directories ask for both.',
    fix: 'Have a plain-background headshot and a three-sentence bio ready to upload.',
    fixHref: null,
  },
  W9: {
    key: 'W9',
    label: 'W-9 ready to send',
    kind: 'MANUAL',
    detail: 'Every company that pays you as a contractor needs one before the first payment.',
    fix: 'Complete a W-9 with your legal name and taxpayer ID and keep the PDF handy.',
    fixHref: null,
  },
  EXPERIENCE_SUMMARY: {
    key: 'EXPERIENCE_SUMMARY',
    label: 'Resume or experience summary',
    kind: 'MANUAL',
    detail: 'A short summary of your notary and signing experience, or a note that you are new.',
    fix: 'Write one page: commission date, signings completed, closing types handled.',
    fixHref: null,
  },
  BUSINESS_PROFILE: {
    key: 'BUSINESS_PROFILE',
    label: 'Claimed online business profile',
    kind: 'MANUAL',
    detail: 'A verified Google Business Profile or similar listing customers can find and review.',
    fix: 'Claim and verify your Google Business Profile with your service area.',
    fixHref: null,
  },
  ELECTRONIC_NOTARY_APPROVAL: {
    key: 'ELECTRONIC_NOTARY_APPROVAL',
    label: 'Approved for electronic / remote notarization',
    kind: 'MANUAL',
    detail:
      'Registration with your commissioning authority to perform electronic or remote notarial ' +
      'acts, where your state requires it.',
    fix: 'Register with your commissioning authority, then tick this once approved.',
    fixHref: null,
  },
};

export function isRequirementKey(value: string): value is RequirementKey {
  return (REQUIREMENT_KEYS as readonly string[]).includes(value);
}

/** The ticked-by-hand requirements, as stored: a comma-separated list of keys. */
export function parseRequirementList(stored: string | null | undefined): Set<RequirementKey> {
  const keys = new Set<RequirementKey>();
  for (const part of (stored ?? '').split(',')) {
    const key = part.trim();
    if (isRequirementKey(key)) keys.add(key);
  }
  return keys;
}

export function serializeRequirementList(keys: Iterable<string>): string {
  const valid = new Set<RequirementKey>();
  for (const key of keys) {
    if (isRequirementKey(key)) valid.add(key);
  }
  // Stable order, so saving an unchanged form does not look like a change.
  return REQUIREMENT_KEYS.filter((key) => valid.has(key)).join(',');
}

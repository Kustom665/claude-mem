/**
 * The enumerated vocabulary of the app.
 *
 * These live here rather than as Prisma enums because the schema targets both
 * SQLite and PostgreSQL and SQLite has no enum support. Everything that writes
 * one of these columns goes through the Zod schemas in validation.ts, which are
 * built from these same arrays — so the database and the UI cannot drift.
 */

export const ACT_TYPES = [
  'ACKNOWLEDGMENT',
  'JURAT',
  'OATH_OR_AFFIRMATION',
  'COPY_CERTIFICATION',
  'SIGNATURE_WITNESSING',
  'PROOF_OF_EXECUTION',
  'OTHER',
] as const;
export type ActType = (typeof ACT_TYPES)[number];

export const ACT_TYPE_LABELS: Record<ActType, string> = {
  ACKNOWLEDGMENT: 'Acknowledgment',
  JURAT: 'Jurat',
  OATH_OR_AFFIRMATION: 'Oath or affirmation',
  COPY_CERTIFICATION: 'Copy certification',
  SIGNATURE_WITNESSING: 'Signature witnessing',
  PROOF_OF_EXECUTION: 'Proof of execution by subscribing witness',
  OTHER: 'Other',
};

/**
 * Whether the act requires the signer to swear or affirm. Jurats and oaths do;
 * acknowledgments do not. The journal form uses this to prompt for the oath.
 */
export const ACTS_REQUIRING_OATH: ReadonlySet<ActType> = new Set<ActType>([
  'JURAT',
  'OATH_OR_AFFIRMATION',
  'PROOF_OF_EXECUTION',
]);

export const IDENTITY_METHODS = [
  'IDENTIFICATION_DOCUMENT',
  'PERSONAL_KNOWLEDGE',
  'CREDIBLE_WITNESS',
] as const;
export type IdentityMethod = (typeof IDENTITY_METHODS)[number];

export const IDENTITY_METHOD_LABELS: Record<IdentityMethod, string> = {
  IDENTIFICATION_DOCUMENT: 'Satisfactory evidence — ID document',
  PERSONAL_KNOWLEDGE: 'Personal knowledge of signer',
  CREDIBLE_WITNESS: 'Credible identifying witness',
};

export const ID_DOCUMENT_TYPES = [
  "Driver's license",
  'State ID card',
  'US passport',
  'Foreign passport',
  'Military ID',
  'Permanent resident card',
  'Tribal ID',
  'Other government-issued ID',
] as const;

export const SIGNING_TYPES = [
  'LOAN_SIGNING',
  'REFINANCE',
  'PURCHASE_BUYER',
  'PURCHASE_SELLER',
  'HELOC',
  'REVERSE_MORTGAGE',
  'LOAN_MODIFICATION',
  'GENERAL_NOTARY_WORK',
  'APOSTILLE',
  'ESTATE_PLANNING',
  'OTHER',
] as const;
export type SigningType = (typeof SIGNING_TYPES)[number];

export const SIGNING_TYPE_LABELS: Record<SigningType, string> = {
  LOAN_SIGNING: 'Loan signing',
  REFINANCE: 'Refinance',
  PURCHASE_BUYER: 'Purchase — buyer',
  PURCHASE_SELLER: 'Purchase — seller',
  HELOC: 'HELOC',
  REVERSE_MORTGAGE: 'Reverse mortgage',
  LOAN_MODIFICATION: 'Loan modification',
  GENERAL_NOTARY_WORK: 'General notary work',
  APOSTILLE: 'Apostille',
  ESTATE_PLANNING: 'Estate planning',
  OTHER: 'Other',
};

export const SIGNING_STATUSES = [
  'SCHEDULED',
  'CONFIRMED',
  'IN_PROGRESS',
  'COMPLETED',
  'CANCELLED',
  'NO_SHOW',
] as const;
export type SigningStatus = (typeof SIGNING_STATUSES)[number];

export const SIGNING_STATUS_LABELS: Record<SigningStatus, string> = {
  SCHEDULED: 'Scheduled',
  CONFIRMED: 'Confirmed',
  IN_PROGRESS: 'In progress',
  COMPLETED: 'Completed',
  CANCELLED: 'Cancelled',
  NO_SHOW: 'No-show',
};

/** Statuses that represent finished, billable work. */
export const BILLABLE_SIGNING_STATUSES: ReadonlySet<SigningStatus> = new Set<SigningStatus>([
  'COMPLETED',
]);

/** Statuses that still occupy a slot on the calendar. */
export const OPEN_SIGNING_STATUSES: ReadonlySet<SigningStatus> = new Set<SigningStatus>([
  'SCHEDULED',
  'CONFIRMED',
  'IN_PROGRESS',
]);

export const CLIENT_TYPES = [
  'SIGNING_SERVICE',
  'TITLE_COMPANY',
  'ESCROW_COMPANY',
  'LENDER',
  'LAW_FIRM',
  'REAL_ESTATE_AGENT',
  'INDIVIDUAL',
  'OTHER',
] as const;
export type ClientType = (typeof CLIENT_TYPES)[number];

export const CLIENT_TYPE_LABELS: Record<ClientType, string> = {
  SIGNING_SERVICE: 'Signing service',
  TITLE_COMPANY: 'Title company',
  ESCROW_COMPANY: 'Escrow company',
  LENDER: 'Lender',
  LAW_FIRM: 'Law firm',
  REAL_ESTATE_AGENT: 'Real estate agent',
  INDIVIDUAL: 'Individual',
  OTHER: 'Other',
};

export const INVOICE_STATUSES = ['DRAFT', 'SENT', 'PAID', 'PARTIAL', 'VOID'] as const;
export type InvoiceStatus = (typeof INVOICE_STATUSES)[number];

export const INVOICE_STATUS_LABELS: Record<InvoiceStatus, string> = {
  DRAFT: 'Draft',
  SENT: 'Sent',
  PAID: 'Paid',
  PARTIAL: 'Partially paid',
  VOID: 'Void',
};

export const FEE_UNITS = ['PER_SIGNATURE', 'PER_ACT', 'FLAT', 'PER_MILE', 'PER_HOUR'] as const;
export type FeeUnit = (typeof FEE_UNITS)[number];

export const FEE_UNIT_LABELS: Record<FeeUnit, string> = {
  PER_SIGNATURE: 'Per signature',
  PER_ACT: 'Per act',
  FLAT: 'Flat fee',
  PER_MILE: 'Per mile',
  PER_HOUR: 'Per hour',
};

export const US_STATES = [
  ['AL', 'Alabama'], ['AK', 'Alaska'], ['AZ', 'Arizona'], ['AR', 'Arkansas'],
  ['CA', 'California'], ['CO', 'Colorado'], ['CT', 'Connecticut'], ['DE', 'Delaware'],
  ['DC', 'District of Columbia'], ['FL', 'Florida'], ['GA', 'Georgia'], ['HI', 'Hawaii'],
  ['ID', 'Idaho'], ['IL', 'Illinois'], ['IN', 'Indiana'], ['IA', 'Iowa'],
  ['KS', 'Kansas'], ['KY', 'Kentucky'], ['LA', 'Louisiana'], ['ME', 'Maine'],
  ['MD', 'Maryland'], ['MA', 'Massachusetts'], ['MI', 'Michigan'], ['MN', 'Minnesota'],
  ['MS', 'Mississippi'], ['MO', 'Missouri'], ['MT', 'Montana'], ['NE', 'Nebraska'],
  ['NV', 'Nevada'], ['NH', 'New Hampshire'], ['NJ', 'New Jersey'], ['NM', 'New Mexico'],
  ['NY', 'New York'], ['NC', 'North Carolina'], ['ND', 'North Dakota'], ['OH', 'Ohio'],
  ['OK', 'Oklahoma'], ['OR', 'Oregon'], ['PA', 'Pennsylvania'], ['RI', 'Rhode Island'],
  ['SC', 'South Carolina'], ['SD', 'South Dakota'], ['TN', 'Tennessee'], ['TX', 'Texas'],
  ['UT', 'Utah'], ['VT', 'Vermont'], ['VA', 'Virginia'], ['WA', 'Washington'],
  ['WV', 'West Virginia'], ['WI', 'Wisconsin'], ['WY', 'Wyoming'],
] as const satisfies ReadonlyArray<readonly [string, string]>;

export function labelFor<T extends string>(
  labels: Record<T, string>,
  value: string,
  fallback = 'Unknown',
): string {
  return (labels as Record<string, string | undefined>)[value] ?? fallback;
}

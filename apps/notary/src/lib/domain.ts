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

// ---------------------------------------------------------------------------
// Finding work
// ---------------------------------------------------------------------------

/** The channels notarization work arrives through. */
export const SOURCE_CATEGORIES = [
  'SIGNING_SERVICE',
  'TITLE_ESCROW',
  'LENDER_BANK',
  'LAW_FIRM',
  'HEALTHCARE_SENIOR',
  'REAL_ESTATE',
  'APOSTILLE_INTL',
  'DIRECTORY',
  'RON_PLATFORM',
  'OTHER',
] as const;
export type SourceCategory = (typeof SOURCE_CATEGORIES)[number];

export const SOURCE_CATEGORY_LABELS: Record<SourceCategory, string> = {
  SIGNING_SERVICE: 'Signing services & dispatch platforms',
  TITLE_ESCROW: 'Title, escrow & closing attorneys',
  LENDER_BANK: 'Lenders, brokers & banks',
  LAW_FIRM: 'Law firms',
  HEALTHCARE_SENIOR: 'Healthcare & senior living',
  REAL_ESTATE: 'Real estate & property managers',
  APOSTILLE_INTL: 'Apostille & international documents',
  DIRECTORY: 'Directories & lead marketplaces',
  RON_PLATFORM: 'Remote online notarization platforms',
  OTHER: 'Other',
};

/** Where a notary's pursuit of one work source stands. */
export const PIPELINE_STATUSES = [
  'RESEARCHING',
  'APPLIED',
  'ONBOARDING',
  'APPROVED',
  'ACTIVE',
  'DECLINED',
  'DORMANT',
] as const;
export type PipelineStatus = (typeof PIPELINE_STATUSES)[number];

export const PIPELINE_STATUS_LABELS: Record<PipelineStatus, string> = {
  RESEARCHING: 'Researching',
  APPLIED: 'Applied',
  ONBOARDING: 'Onboarding',
  APPROVED: 'Approved — on the list',
  ACTIVE: 'Receiving work',
  DECLINED: 'Declined',
  DORMANT: 'Gone quiet',
};

/** Statuses where an answer is still pending, so a follow-up date matters. */
export const PIPELINE_OPEN_STATUSES: ReadonlySet<PipelineStatus> = new Set<PipelineStatus>([
  'RESEARCHING',
  'APPLIED',
  'ONBOARDING',
  'APPROVED',
]);

/** Inbound requests captured by the public request link. */
export const REQUEST_STATUSES = ['NEW', 'CONTACTED', 'ACCEPTED', 'DECLINED', 'SPAM'] as const;
export type RequestStatus = (typeof REQUEST_STATUSES)[number];

export const REQUEST_STATUS_LABELS: Record<RequestStatus, string> = {
  NEW: 'New',
  CONTACTED: 'Contacted',
  ACCEPTED: 'Accepted',
  DECLINED: 'Declined',
  SPAM: 'Spam',
};

export const REQUEST_SERVICES = [
  'GENERAL',
  'LOAN_SIGNING',
  'ESTATE_PLANNING',
  'REAL_ESTATE',
  'INTERNATIONAL',
  'OTHER',
] as const;
export type RequestService = (typeof REQUEST_SERVICES)[number];

export const REQUEST_SERVICE_LABELS: Record<RequestService, string> = {
  GENERAL: 'General notarization (affidavits, forms, letters)',
  LOAN_SIGNING: 'Mortgage or loan signing',
  ESTATE_PLANNING: 'Wills, powers of attorney, healthcare directives',
  REAL_ESTATE: 'Deeds and other real estate documents',
  INTERNATIONAL: 'Documents for international use (apostille)',
  OTHER: 'Something else',
};

/** What a request becomes on the calendar once it is accepted. */
export const REQUEST_SERVICE_TO_SIGNING_TYPE: Record<RequestService, SigningType> = {
  GENERAL: 'GENERAL_NOTARY_WORK',
  LOAN_SIGNING: 'LOAN_SIGNING',
  ESTATE_PLANNING: 'ESTATE_PLANNING',
  REAL_ESTATE: 'GENERAL_NOTARY_WORK',
  INTERNATIONAL: 'APOSTILLE',
  OTHER: 'OTHER',
};

export const CONTACT_PREFERENCES = ['ANY', 'PHONE', 'TEXT', 'EMAIL'] as const;
export type ContactPreference = (typeof CONTACT_PREFERENCES)[number];

export const CONTACT_PREFERENCE_LABELS: Record<ContactPreference, string> = {
  ANY: 'Any',
  PHONE: 'Phone call',
  TEXT: 'Text message',
  EMAIL: 'Email',
};

export const TIME_WINDOWS = ['FLEXIBLE', 'MORNING', 'AFTERNOON', 'EVENING'] as const;
export type TimeWindow = (typeof TIME_WINDOWS)[number];

export const TIME_WINDOW_LABELS: Record<TimeWindow, string> = {
  FLEXIBLE: 'Flexible',
  MORNING: 'Morning (8 am – noon)',
  AFTERNOON: 'Afternoon (noon – 5 pm)',
  EVENING: 'Evening (after 5 pm)',
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

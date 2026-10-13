import { z } from 'zod';
import {
  ACT_TYPES,
  CLIENT_TYPES,
  CONTACT_PREFERENCES,
  FEE_UNITS,
  IDENTITY_METHODS,
  INVOICE_STATUSES,
  PIPELINE_STATUSES,
  REQUEST_SERVICES,
  SIGNING_STATUSES,
  SIGNING_TYPES,
  SOURCE_CATEGORIES,
  TIME_WINDOWS,
} from './domain';
import { interpretWallClock } from './dates';
import { parseMoneyToCents } from './money';
import { checkSlug, isRequestService } from './request-link';

/**
 * Input validation.
 *
 * Every server action funnels its FormData through one of these schemas. The
 * enumerated values come from domain.ts, so a value that reaches the database
 * is always one the UI knows how to render.
 */

/**
 * Normalise a missing FormData key to an empty string.
 *
 * A browser omits a form control from the submission entirely when it was
 * never rendered or, for a checkbox, was left unchecked. This app renders
 * controls conditionally on purpose — Pennsylvania forbids a thumbprint field,
 * credible-witness inputs appear only for that identification method, the RON
 * platform only for a remote act — so absent keys are the normal case, not an
 * error.
 *
 * Without this, every conditionally-rendered field failed validation with
 * "expected string, received undefined", and because those fields have no
 * visible input the errors had nowhere to render: the form simply did nothing.
 * In Pennsylvania that made it impossible to record any journal entry at all.
 */
const absentAsEmpty = (value: unknown) => (value === undefined || value === null ? '' : value);

/** Trim, and treat an empty or absent value as null. */
const optionalText = z.preprocess(
  absentAsEmpty,
  z
    .string()
    .trim()
    .transform((value) => (value === '' ? null : value)),
);

/** An optional email address: trimmed, lower-cased, and refused if it is not one. */
const optionalEmail = z.preprocess(
  absentAsEmpty,
  z
    .string()
    .trim()
    .transform((value, ctx) => {
      if (value === '') return null;
      if (value.length > 254 || !z.email().safeParse(value).success) {
        ctx.addIssue({ code: 'custom', message: 'Enter a valid email address.' });
        return z.NEVER;
      }
      return value.toLowerCase();
    }),
);

const requiredText = (field: string, max = 500) =>
  z.preprocess(
    absentAsEmpty,
    z.string().trim().min(1, `${field} is required.`).max(max, `${field} is too long.`),
  );

/** Money arrives as free text ("$15", "15.00"); store integer cents. */
const moneyCents = z.preprocess(
  absentAsEmpty,
  z
    .string()
    .trim()
    .transform((value, ctx) => {
    if (value === '') return 0;
    const cents = parseMoneyToCents(value);
    if (cents === null) {
      ctx.addIssue({ code: 'custom', message: 'Enter a valid dollar amount.' });
      return z.NEVER;
    }
      if (cents < 0) {
        ctx.addIssue({ code: 'custom', message: 'Amount cannot be negative.' });
        return z.NEVER;
      }
      return cents;
    }),
);

const optionalDate = z.preprocess(
  absentAsEmpty,
  z
    .string()
    .trim()
    .transform((value, ctx) => {
      if (value === '') return null;
      const date = new Date(value);
      if (Number.isNaN(date.getTime())) {
        ctx.addIssue({ code: 'custom', message: 'Enter a valid date.' });
        return z.NEVER;
      }
      return date;
    }),
);

const requiredDate = z.preprocess(
  absentAsEmpty,
  z
    .string()
    .trim()
    .min(1, 'Date is required.')
    .transform((value, ctx) => {
      const date = new Date(value);
      if (Number.isNaN(date.getTime())) {
        ctx.addIssue({ code: 'custom', message: 'Enter a valid date.' });
        return z.NEVER;
      }
      return date;
    }),
);

/**
 * An unchecked checkbox is absent from FormData entirely, so anything that is
 * not an affirmative value means false.
 */
const checkbox = z.preprocess(
  (value) => value === 'on' || value === 'true' || value === '1',
  z.boolean(),
);

/**
 * Options that make a cross-field rule run even when another field has already
 * failed.
 *
 * By default Zod skips an object's refinements as soon as any field is invalid,
 * so a form with two mistakes shows the first, and only after it is fixed and
 * resubmitted the second — a round trip per mistake. Rules that use this must
 * cope with a field being `undefined`: that is what a failed field looks like.
 */
const runAlways = { when: () => true } as const;

const positiveInt = (field: string, max = 1_000_000) =>
  z.preprocess(
    (value) => (value === undefined || value === null || value === '' ? undefined : value),
    z.coerce.number().int(`${field} must be a whole number.`).min(0).max(max),
  );

// ---------------------------------------------------------------------------
// Auth
// ---------------------------------------------------------------------------

export const signUpSchema = z.object({
  name: requiredText('Your name', 120),
  email: z.string().trim().toLowerCase().pipe(z.email('Enter a valid email address.')),
  password: z
    .string()
    .min(10, 'Use at least 10 characters.')
    .max(200, 'Password is too long.'),
  commissionState: z.string().trim().length(2, 'Select your state.').toUpperCase(),
});
export type SignUpInput = z.infer<typeof signUpSchema>;

export const signInSchema = z.object({
  email: z.string().trim().toLowerCase().pipe(z.email('Enter a valid email address.')),
  password: z.string().min(1, 'Enter your password.'),
});

// ---------------------------------------------------------------------------
// Journal
// ---------------------------------------------------------------------------

/**
 * A journal entry.
 *
 * Note what is deliberately absent: there is no field for a full identification
 * number, a date of birth, or a Social Security number. Pennsylvania prohibits
 * recording those (effective 28 March 2026) and no state requires them, so the
 * safest design is to make them unrepresentable rather than validated.
 */
export const journalEntrySchema = z
  .object({
    performedAt: requiredDate,
    actType: z.enum(ACT_TYPES),
    documentType: requiredText('Document type', 200),
    documentDate: optionalDate,
    documentDescription: optionalText,
    numberOfSignatures: positiveInt('Number of signatures', 100).default(1),

    signerName: requiredText('Signer name', 200),
    signerAddressLine1: optionalText,
    signerCity: optionalText,
    signerState: optionalText,
    signerPostalCode: optionalText,
    signerPhone: optionalText,
    signerEmail: optionalEmail,

    identityMethod: z.enum(IDENTITY_METHODS),
    idType: optionalText,
    idIssuer: optionalText,
    // Uses optionalText for the same absent-key reason as everything else: the
    // identification inputs are only rendered when the signer was identified
    // by document, so this key is missing for personal knowledge and credible
    // witness.
    idNumberLast4: optionalText.refine(
      (value) => value === null || /^\d{4}$/.test(value),
      'Record only the last four digits of the ID number.',
    ),
    idIssuedOn: optionalDate,
    idExpiresOn: optionalDate,
    credibleWitnessName: optionalText,
    credibleWitnessAddress: optionalText,
    secondCredibleWitnessName: optionalText,

    feeChargedCents: moneyCents,
    travelFeeCents: moneyCents,

    notarizedRemotely: checkbox,
    ronPlatform: optionalText,
    thumbprintTaken: checkbox,
    witnessNames: optionalText,
    locationCity: optionalText,
    locationState: optionalText,
    notes: optionalText,

    signingId: optionalText,
    amendsEntryId: optionalText,
    amendmentReason: optionalText,
  })
  // Cross-field rules. Each runs even if another field failed (see runAlways), so
  // one submit reports every mistake, and each is written for a field that may
  // be undefined because it failed.
  .refine(
    // An ID-based identification is only meaningful if we know what was shown.
    (value) => value.identityMethod !== 'IDENTIFICATION_DOCUMENT' || Boolean(value.idType),
    { path: ['idType'], message: 'Record which identification document you relied on.', ...runAlways },
  )
  .refine(
    (value) => value.identityMethod !== 'CREDIBLE_WITNESS' || Boolean(value.credibleWitnessName),
    {
      path: ['credibleWitnessName'],
      message: 'Record the name of the credible identifying witness.',
      ...runAlways,
    },
  )
  .refine(
    // An expired ID cannot establish satisfactory evidence of identity.
    (value) =>
      !(value.idExpiresOn instanceof Date && value.performedAt instanceof Date) ||
      value.idExpiresOn.getTime() >= value.performedAt.getTime(),
    {
      path: ['idExpiresOn'],
      message: 'This identification had expired on the date of the act.',
      ...runAlways,
    },
  )
  .refine((value) => !value.notarizedRemotely || Boolean(value.ronPlatform), {
    path: ['ronPlatform'],
    message: 'Record which platform was used for the remote notarization.',
    ...runAlways,
  })
  .refine((value) => !value.amendsEntryId || Boolean(value.amendmentReason), {
    path: ['amendmentReason'],
    message: 'Explain what this amendment corrects.',
    ...runAlways,
  });

export type JournalEntryInput = z.infer<typeof journalEntrySchema>;

// ---------------------------------------------------------------------------
// Clients
// ---------------------------------------------------------------------------

export const clientSchema = z.object({
  name: requiredText('Client name', 200),
  type: z.enum(CLIENT_TYPES),
  contactName: optionalText,
  email: optionalEmail,
  phone: optionalText,
  addressLine1: optionalText,
  addressLine2: optionalText,
  city: optionalText,
  state: optionalText,
  postalCode: optionalText,
  defaultFeeCents: moneyCents,
  paymentTermsDays: positiveInt('Payment terms', 365).default(30),
  notes: optionalText,
  isActive: checkbox,
});

// ---------------------------------------------------------------------------
// Signings
// ---------------------------------------------------------------------------

export const signingSchema = z.object({
  title: requiredText('Title', 200),
  clientId: optionalText,
  type: z.enum(SIGNING_TYPES),
  status: z.enum(SIGNING_STATUSES),
  scheduledAt: requiredDate,
  durationMinutes: positiveInt('Duration', 1440).default(60),

  signerName: optionalText,
  signerPhone: optionalText,
  signerEmail: optionalEmail,
  coSignerName: optionalText,

  locationName: optionalText,
  addressLine1: optionalText,
  addressLine2: optionalText,
  city: optionalText,
  state: optionalText,
  postalCode: optionalText,

  loanNumber: optionalText,
  escrowNumber: optionalText,
  propertyAddress: optionalText,
  documentCount: z.coerce.number().int().min(0).max(10_000).nullable().catch(null),

  signingFeeCents: moneyCents,
  travelFeeCents: moneyCents,
  printFeeCents: moneyCents,
  additionalFeeCents: moneyCents,
  mileageMiles: z.coerce.number().min(0).max(10_000).catch(0),

  scanBacksRequired: checkbox,
  shippingCarrier: optionalText,
  trackingNumber: optionalText,
  docsReturnedAt: optionalDate,
  notes: optionalText,
});

// ---------------------------------------------------------------------------
// Mileage
// ---------------------------------------------------------------------------

export const mileageSchema = z.object({
  date: requiredDate,
  miles: z.coerce.number().min(0.1, 'Enter the distance traveled.').max(10_000),
  ratePerMileCents: z.coerce.number().min(0).max(1000),
  purpose: requiredText('Purpose', 200),
  fromAddress: optionalText,
  toAddress: optionalText,
  signingId: optionalText,
  notes: optionalText,
});

// ---------------------------------------------------------------------------
// Billing
// ---------------------------------------------------------------------------

export const feeScheduleSchema = z.object({
  name: requiredText('Name', 120),
  actType: optionalText,
  amountCents: moneyCents,
  unit: z.enum(FEE_UNITS),
  stateMaxCents: moneyCents.nullable().catch(null),
  notes: optionalText,
  isActive: checkbox,
});

export const invoiceSchema = z.object({
  clientId: requiredText('Client', 60),
  issueDate: requiredDate,
  dueDate: requiredDate,
  status: z.enum(INVOICE_STATUSES),
  taxCents: moneyCents,
  notes: optionalText,
  terms: optionalText,
});

export const invoicePaymentSchema = z.object({
  amountPaidCents: moneyCents,
  paidAt: optionalDate,
});

// ---------------------------------------------------------------------------
// Settings
// ---------------------------------------------------------------------------

export const profileSchema = z.object({
  name: requiredText('Your name', 120),
  businessName: optionalText,
  phone: optionalText,
  addressLine1: optionalText,
  addressLine2: optionalText,
  city: optionalText,
  state: optionalText,
  postalCode: optionalText,
  timezone: requiredText('Timezone', 60),
  mileageRateCents: z.coerce.number().min(0).max(1000),
  invoicePrefix: requiredText('Invoice prefix', 10),
  invoiceTermsDays: positiveInt('Invoice terms', 365).default(30),
});

export const commissionSchema = z.object({
  commissionNumber: optionalText,
  commissionState: z.string().trim().length(2, 'Select your commission state.').toUpperCase(),
  commissionCounty: optionalText,
  commissionIssuedOn: optionalDate,
  commissionExpiresOn: optionalDate,
  sealDescription: optionalText,
  isSigningAgent: checkbox,
  backgroundCheckExpiresOn: optionalDate,
  eoPolicyNumber: optionalText,
  eoCoverageCents: moneyCents,
  eoExpiresOn: optionalDate,
  bondNumber: optionalText,
  bondAmountCents: moneyCents,
  bondExpiresOn: optionalDate,
  journalStartNumber: positiveInt('Starting journal number', 10_000_000).default(1),
});

export const certificateTemplateSchema = z.object({
  name: requiredText('Name', 120),
  actType: z.enum(ACT_TYPES),
  state: optionalText,
  body: requiredText('Certificate wording', 8000),
});

export const integrationSchema = z.object({
  webhookUrl: optionalText,
  webhookSecret: optionalText,
  enabled: checkbox,
});

// ---------------------------------------------------------------------------
// Finding work
// ---------------------------------------------------------------------------

/** Optional free text with an upper bound, for fields that end up in a database row. */
const boundedText = (field: string, max: number) =>
  optionalText.refine((value) => value === null || value.length <= max, `${field} is too long.`);

/**
 * An optional web address.
 *
 * Only http and https survive. A pipeline entry renders its website as a link, so a
 * `javascript:` or `data:` URL typed — or pasted from somewhere hostile — into
 * this field would otherwise become a script link on the notary's own page.
 */
const optionalWebUrl = z.preprocess(
  absentAsEmpty,
  z
    .string()
    .trim()
    .transform((value, ctx) => {
      if (value === '') return null;
      // Be kind to "example.com" typed without a scheme.
      const candidate = /^[a-z][a-z0-9+.-]*:/i.test(value) ? value : `https://${value}`;
      try {
        const url = new URL(candidate);
        if ((url.protocol !== 'https:' && url.protocol !== 'http:') || !url.hostname.includes('.')) {
          throw new Error('unsupported');
        }
        return url.toString();
      } catch {
        ctx.addIssue({ code: 'custom', message: 'Enter a web address like example.com.' });
        return z.NEVER;
      }
    }),
);

/** A phone number is "ten to fifteen digits, however they are punctuated". */
const optionalPhone = z.preprocess(
  absentAsEmpty,
  z
    .string()
    .trim()
    .transform((value, ctx) => {
      if (value === '') return null;
      const digits = value.replace(/\D/g, '');
      if (value.length > 40 || digits.length < 10 || digits.length > 15) {
        ctx.addIssue({ code: 'custom', message: 'Enter a phone number with area code.' });
        return z.NEVER;
      }
      return value;
    }),
);

export const sourceApplicationSchema = z.object({
  name: requiredText('Name', 160),
  category: z.enum(SOURCE_CATEGORIES),
  status: z.enum(PIPELINE_STATUSES),
  website: optionalWebUrl,
  contactName: boundedText('Contact name', 120),
  contactEmail: optionalEmail,
  contactPhone: optionalPhone,
  appliedOn: optionalDate,
  lastContactOn: optionalDate,
  nextFollowUpOn: optionalDate,
  notes: boundedText('Notes', 4000),
});

export type SourceApplicationInput = z.infer<typeof sourceApplicationSchema>;

const MS_PER_DAY = 24 * 60 * 60 * 1000;

/**
 * A request from the public form.
 *
 * Deliberately narrow. There is no field for an ID number, a date of birth or a
 * document upload, and the copy around the form says so: this is a way to ask a
 * notary to call, not a place to hand over anything sensitive.
 */
export const publicRequestSchema = z
  .object({
    requesterName: requiredText('Your name', 120),
    requesterPhone: optionalPhone,
    requesterEmail: optionalEmail,
    preferredContact: z.enum(CONTACT_PREFERENCES, { error: 'Choose how to reach you.' }).default('ANY'),
    service: z.enum(REQUEST_SERVICES, { error: 'Choose what you need.' }),
    documentSummary: boundedText('The document description', 500),
    signerCount: z.preprocess(
      (value) => (value === undefined || value === null || value === '' ? 1 : value),
      z.coerce.number().int('Enter a whole number of signers.').min(1).max(20),
    ),
    preferredDate: optionalDate,
    preferredWindow: z.enum(TIME_WINDOWS, { error: 'Choose a time of day.' }).default('FLEXIBLE'),
    addressLine1: boundedText('The address', 200),
    city: requiredText('City', 80),
    state: z.string().trim().length(2, 'Select your state.').toUpperCase(),
    postalCode: z
      .preprocess(absentAsEmpty, z.string().trim())
      .pipe(z.string().regex(/^\d{5}(-\d{4})?$/, 'Enter a 5-digit ZIP code.')),
    message: boundedText('The message', 1000),
    consent: checkbox,
  })
  .refine((value) => Boolean(value.requesterPhone || value.requesterEmail), {
    path: ['requesterPhone'],
    message: 'Give a phone number or an email so the notary can reach you.',
    ...runAlways,
  })
  .refine((value) => value.consent === true, {
    path: ['consent'],
    message: 'Please confirm you are happy to be contacted about this request.',
    ...runAlways,
  })
  .refine(
    // The date is a bare calendar day (UTC midnight), so allow for time zones.
    (value) =>
      !(value.preferredDate instanceof Date) ||
      value.preferredDate.getTime() - Date.now() >= -1.5 * MS_PER_DAY,
    { path: ['preferredDate'], message: 'Choose today or a later date.', ...runAlways },
  )
  .refine(
    (value) =>
      !(value.preferredDate instanceof Date) ||
      value.preferredDate.getTime() - Date.now() <= 366 * MS_PER_DAY,
    { path: ['preferredDate'], message: 'Choose a date within the next year.', ...runAlways },
  );

export type PublicRequestInput = z.infer<typeof publicRequestSchema>;

/** The notary's public request link settings. */
export const requestLinkSchema = z
  .object({
    publicSlug: z.preprocess(
      absentAsEmpty,
      z
        .string()
        .trim()
        .transform((value, ctx) => {
          if (value === '') return null;
          const result = checkSlug(value);
          if (!result.ok) {
            ctx.addIssue({ code: 'custom', message: result.message });
            return z.NEVER;
          }
          return result.slug;
        }),
    ),
    acceptingRequests: checkbox,
    publicHeadline: boundedText('The headline', 120),
    publicBio: boundedText('The introduction', 600),
    serviceArea: boundedText('The service area', 200),
    /** Joined by the action from the repeated checkbox values. */
    servicesOffered: z.preprocess(
      absentAsEmpty,
      z
        .string()
        .trim()
        .transform((value) =>
          value
            .split(',')
            .map((part) => part.trim())
            .filter(isRequestService),
        ),
    ),
    requestMinNoticeHours: positiveInt('Notice', 720).default(24),
    showFeesPublicly: checkbox,
    showPhonePublicly: checkbox,
  })
  .refine((value) => !value.acceptingRequests || Boolean(value.publicSlug), {
    path: ['publicSlug'],
    message: 'Choose the address your link will use before you switch it on.',
    ...runAlways,
  })
  .refine((value) => !value.acceptingRequests || (value.servicesOffered?.length ?? 0) > 0, {
    path: ['servicesOffered'],
    message: 'Pick at least one service you are happy to take on.',
    ...runAlways,
  });

export type RequestLinkInput = z.infer<typeof requestLinkSchema>;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Form fields that hold a wall-clock date or time typed by the notary.
 *
 * Named explicitly, not detected by shape: a loan number or a free-text note
 * that happens to look like `2026-10-20` must stay exactly what was typed.
 */
const WALL_CLOCK_FIELDS: ReadonlySet<string> = new Set([
  // Instants, from <input type="datetime-local">
  'performedAt',
  'scheduledAt',
  // Calendar dates, from <input type="date">
  'documentDate',
  'idIssuedOn',
  'idExpiresOn',
  'docsReturnedAt',
  'date',
  'issueDate',
  'dueDate',
  'paidAt',
  'commissionIssuedOn',
  'commissionExpiresOn',
  'backgroundCheckExpiresOn',
  'eoExpiresOn',
  'bondExpiresOn',
  'appliedOn',
  'lastContactOn',
  'nextFollowUpOn',
]);

/**
 * FormData → plain object, so Zod can coerce and report per-field errors.
 *
 * Pass the signed-in notary's `timeZone` for any form that carries dates. A
 * browser's date and datetime-local fields send zone-less wall-clock strings,
 * and without the notary's zone they are read in the server's — which on a
 * hosted deployment is UTC, not the notary's clock. Omit it for forms whose
 * dates are not the notary's (the public request form).
 */
export function formDataToObject(
  formData: FormData,
  timeZone?: string,
): Record<string, string> {
  const result: Record<string, string> = {};
  for (const [key, value] of formData.entries()) {
    if (typeof value !== 'string') continue;

    if (timeZone && WALL_CLOCK_FIELDS.has(key)) {
      const instant = interpretWallClock(value.trim(), timeZone);
      result[key] = instant ? instant.toISOString() : value;
    } else {
      result[key] = value;
    }
  }
  return result;
}

export type FieldErrors = Record<string, string>;

/** Flatten a ZodError into `{ fieldName: firstMessage }` for form rendering. */
export function toFieldErrors(error: z.ZodError): FieldErrors {
  const errors: FieldErrors = {};
  for (const issue of error.issues) {
    const key = issue.path.length > 0 ? issue.path.join('.') : '_form';
    if (!(key in errors)) errors[key] = issue.message;
  }
  return errors;
}

export type ActionResult<T = void> =
  | { ok: true; data: T }
  | { ok: false; errors: FieldErrors; message?: string };

export function fail(errors: FieldErrors, message?: string): ActionResult<never> {
  return { ok: false, errors, message };
}

export function formError(message: string): ActionResult<never> {
  return { ok: false, errors: { _form: message }, message };
}

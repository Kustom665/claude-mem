import { z } from 'zod';
import {
  ACT_TYPES,
  CLIENT_TYPES,
  FEE_UNITS,
  IDENTITY_METHODS,
  INVOICE_STATUSES,
  SIGNING_STATUSES,
  SIGNING_TYPES,
} from './domain';
import { parseMoneyToCents } from './money';

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
    signerEmail: optionalText,

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
  .superRefine((value, ctx) => {
    // An ID-based identification is only meaningful if we know what was shown.
    if (value.identityMethod === 'IDENTIFICATION_DOCUMENT' && !value.idType) {
      ctx.addIssue({
        code: 'custom',
        path: ['idType'],
        message: 'Record which identification document you relied on.',
      });
    }

    if (value.identityMethod === 'CREDIBLE_WITNESS' && !value.credibleWitnessName) {
      ctx.addIssue({
        code: 'custom',
        path: ['credibleWitnessName'],
        message: 'Record the name of the credible identifying witness.',
      });
    }

    // An expired ID cannot establish satisfactory evidence of identity.
    if (value.idExpiresOn && value.idExpiresOn.getTime() < value.performedAt.getTime()) {
      ctx.addIssue({
        code: 'custom',
        path: ['idExpiresOn'],
        message: 'This identification had expired on the date of the act.',
      });
    }

    if (value.notarizedRemotely && !value.ronPlatform) {
      ctx.addIssue({
        code: 'custom',
        path: ['ronPlatform'],
        message: 'Record which platform was used for the remote notarization.',
      });
    }

    if (value.amendsEntryId && !value.amendmentReason) {
      ctx.addIssue({
        code: 'custom',
        path: ['amendmentReason'],
        message: 'Explain what this amendment corrects.',
      });
    }
  });

export type JournalEntryInput = z.infer<typeof journalEntrySchema>;

// ---------------------------------------------------------------------------
// Clients
// ---------------------------------------------------------------------------

export const clientSchema = z.object({
  name: requiredText('Client name', 200),
  type: z.enum(CLIENT_TYPES),
  contactName: optionalText,
  email: optionalText,
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
  signerEmail: optionalText,
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
  miles: z.coerce.number().min(0.1, 'Enter the distance travelled.').max(10_000),
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
// Helpers
// ---------------------------------------------------------------------------

/** FormData → plain object, so Zod can coerce and report per-field errors. */
export function formDataToObject(formData: FormData): Record<string, string> {
  const result: Record<string, string> = {};
  for (const [key, value] of formData.entries()) {
    if (typeof value === 'string') result[key] = value;
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

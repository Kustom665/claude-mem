import { z } from "zod";

import { DEFAULT_HOURS, TIME_RE, isValidTimeZone } from "@/lib/hours";
import { DAY_KEYS, type BusinessHours } from "@/types/database";

export type FieldErrors = Record<string, string>;

/** First message per field, which is all the forms render. */
export function fieldErrors(error: z.ZodError): FieldErrors {
  const errors: FieldErrors = {};
  for (const issue of error.issues) {
    const key = issue.path.length > 0 ? String(issue.path[0]) : "form";
    errors[key] ??= issue.message;
  }
  return errors;
}

// ---------------------------------------------------------------------------
// Auth
// ---------------------------------------------------------------------------

const email = z
  .string()
  .trim()
  .min(1, "Enter your email address.")
  .pipe(z.email("Enter a valid email address."));

export const signUpSchema = z.object({
  agencyName: z
    .string()
    .trim()
    .min(1, "Enter your agency name.")
    .max(120, "Agency name must be 120 characters or fewer."),
  email,
  password: z.string().min(8, "Use at least 8 characters."),
});

export const signInSchema = z.object({
  email,
  password: z.string().min(1, "Enter your password."),
});

// ---------------------------------------------------------------------------
// Branding
// ---------------------------------------------------------------------------

export const brandingSchema = z.object({
  name: z
    .string()
    .trim()
    .min(1, "Enter your business name.")
    .max(120, "Business name must be 120 characters or fewer."),
  primaryColor: z
    .string()
    .trim()
    .regex(/^#[0-9a-fA-F]{6}$/, "Pick a colour in #rrggbb format."),
  logoUrl: z
    .string()
    .trim()
    .max(2048)
    .refine((value) => value === "" || /^https:\/\//i.test(value), {
      message: "Logo URL must be https.",
    })
    .transform((value) => (value === "" ? null : value)),
});

// ---------------------------------------------------------------------------
// Clients
// ---------------------------------------------------------------------------

/**
 * Normalises what people actually type — "(555) 010-1234", "555-010-1234",
 * "+44 20 7946 0000" — into E.164. Bare 10-digit and 1-prefixed 11-digit
 * inputs are treated as North American; anything else must carry a `+`.
 */
export function normalizePhoneNumber(input: string): string | null {
  const trimmed = input.trim();
  const hadPlus = trimmed.startsWith("+");
  const digits = trimmed.replace(/\D/g, "");

  if (digits.length === 0) return null;

  let e164: string;
  if (hadPlus) {
    e164 = `+${digits}`;
  } else if (digits.length === 10) {
    e164 = `+1${digits}`;
  } else if (digits.length === 11 && digits.startsWith("1")) {
    e164 = `+${digits}`;
  } else {
    return null;
  }

  return /^\+[1-9]\d{7,14}$/.test(e164) ? e164 : null;
}

const dayHoursSchema = z.object({
  closed: z.boolean(),
  open: z.string().regex(TIME_RE, "Use 24-hour HH:MM times."),
  close: z.string().regex(TIME_RE, "Use 24-hour HH:MM times."),
});

export const businessHoursSchema = z
  .object({
    mon: dayHoursSchema,
    tue: dayHoursSchema,
    wed: dayHoursSchema,
    thu: dayHoursSchema,
    fri: dayHoursSchema,
    sat: dayHoursSchema,
    sun: dayHoursSchema,
  })
  .refine(
    (hours) => DAY_KEYS.every((day) => hours[day].closed || hours[day].open !== hours[day].close),
    { message: "Opening and closing times must differ on open days." },
  );

export const clientSchema = z.object({
  businessName: z
    .string()
    .trim()
    .min(1, "Enter the client's business name.")
    .max(120, "Business name must be 120 characters or fewer."),
  phoneNumber: z
    .string()
    .trim()
    .min(1, "Enter the client's phone number.")
    .transform((value, ctx) => {
      const normalized = normalizePhoneNumber(value);
      if (!normalized) {
        ctx.addIssue({
          code: "custom",
          message:
            "Enter a valid phone number, including the country code (e.g. +1 555 010 1234).",
        });
        return z.NEVER;
      }
      return normalized;
    }),
  timezone: z
    .string()
    .trim()
    .min(1, "Pick a timezone.")
    .refine(isValidTimeZone, { message: "Pick a valid timezone." }),
  hours: businessHoursSchema,
  autoReplyMessage: z
    .string()
    .trim()
    .min(1, "Write the text customers receive after a missed call.")
    .max(1200, "Auto-reply must be 1200 characters or fewer."),
  status: z.enum(["active", "paused"]),
  resalePriceCents: z
    .number()
    .int()
    .min(0, "Resale price cannot be negative.")
    .max(100_000_000, "That resale price looks too large.")
    .nullable(),
});

export type ClientInput = z.output<typeof clientSchema>;

/** "297", "297.50", "$297.50", "" -> cents | null. Returns undefined if unparseable. */
export function parsePriceToCents(
  input: string,
): number | null | undefined {
  const cleaned = input.replace(/[$,\s]/g, "").trim();
  if (cleaned === "") return null;
  if (!/^\d+(\.\d{1,2})?$/.test(cleaned)) return undefined;
  return Math.round(Number(cleaned) * 100);
}

/** Rebuilds the weekly schedule from the flat `hours.<day>.<field>` form fields. */
export function businessHoursFromFormData(formData: FormData): BusinessHours {
  const hours = {} as BusinessHours;

  for (const day of DAY_KEYS) {
    const fallback = DEFAULT_HOURS[day];
    hours[day] = {
      closed: formData.get(`hours.${day}.closed`) !== "open",
      open: String(formData.get(`hours.${day}.open`) ?? fallback.open),
      close: String(formData.get(`hours.${day}.close`) ?? fallback.close),
    };
  }

  return hours;
}

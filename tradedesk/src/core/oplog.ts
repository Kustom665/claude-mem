/**
 * Operations log: validation of custom day-to-day entries.
 *
 * Entry shapes are user-defined per account, so values arrive as free-form JSON
 * and must be checked against the template before storage. Validation returns
 * every error at once rather than throwing on the first, so a data-entry form
 * can highlight all bad fields in one pass.
 */

export type FieldType =
  | "text" | "number" | "date" | "boolean" | "select" | "member" | "customer";

export interface FieldDef {
  key: string;
  label: string;
  type: FieldType;
  required?: boolean;
  /** Permitted values for `select`. Ignored for other types. */
  options?: readonly string[];
  /** Inclusive bounds for `number`; character bounds for `text`. */
  min?: number;
  max?: number;
}

export interface Template {
  id: string;
  name: string;
  fields: readonly FieldDef[];
}

export interface FieldError {
  key: string;
  message: string;
}

export type ValidationResult =
  | { ok: true; values: Record<string, unknown> }
  | { ok: false; errors: FieldError[] };

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/** True only for a real calendar date, so 2026-02-30 is rejected. */
function isCalendarDate(s: string): boolean {
  if (!DATE_RE.test(s)) return false;
  const [y, m, d] = s.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  return (
    dt.getUTCFullYear() === y &&
    dt.getUTCMonth() === m - 1 &&
    dt.getUTCDate() === d
  );
}

function checkOne(f: FieldDef, raw: unknown): string | null {
  switch (f.type) {
    case "text": {
      if (typeof raw !== "string") return "must be text";
      if (f.min !== undefined && raw.length < f.min)
        return `must be at least ${f.min} characters`;
      if (f.max !== undefined && raw.length > f.max)
        return `must be at most ${f.max} characters`;
      return null;
    }
    case "number": {
      // Reject NaN/Infinity explicitly: both are typeof "number" and both
      // serialize to null in JSON, silently corrupting the stored value.
      if (typeof raw !== "number" || !Number.isFinite(raw))
        return "must be a number";
      if (f.min !== undefined && raw < f.min) return `must be at least ${f.min}`;
      if (f.max !== undefined && raw > f.max) return `must be at most ${f.max}`;
      return null;
    }
    case "boolean":
      return typeof raw === "boolean" ? null : "must be true or false";
    case "date":
      return typeof raw === "string" && isCalendarDate(raw)
        ? null
        : "must be a valid date (YYYY-MM-DD)";
    case "select":
      if (typeof raw !== "string") return "must be one of the listed options";
      return f.options?.includes(raw)
        ? null
        : `must be one of: ${(f.options ?? []).join(", ")}`;
    case "member":
    case "customer":
      return typeof raw === "string" && UUID_RE.test(raw)
        ? null
        : `must reference a valid ${f.type}`;
  }
}

/** A value the user left blank, in any of the forms a form control produces. */
function isBlank(v: unknown): boolean {
  return v === undefined || v === null || v === "";
}

/**
 * Validate `input` against `template`.
 *
 * Unknown keys are dropped rather than rejected: templates change over time,
 * and a stale client should not be able to write unvalidated data.
 */
export function validateEntry(
  template: Template,
  input: Record<string, unknown>,
): ValidationResult {
  const errors: FieldError[] = [];
  const values: Record<string, unknown> = {};

  for (const f of template.fields) {
    const raw = input[f.key];

    if (isBlank(raw)) {
      if (f.required) errors.push({ key: f.key, message: "is required" });
      continue;
    }

    const err = checkOne(f, raw);
    if (err) errors.push({ key: f.key, message: err });
    else values[f.key] = raw;
  }

  return errors.length ? { ok: false, errors } : { ok: true, values };
}

/**
 * Reject a template whose own definition is malformed, before it is saved and
 * starts producing confusing entry errors.
 */
export function validateTemplate(fields: readonly FieldDef[]): FieldError[] {
  const errors: FieldError[] = [];
  const seen = new Set<string>();

  for (const f of fields) {
    if (!/^[a-z][a-z0-9_]*$/.test(f.key)) {
      errors.push({
        key: f.key,
        message: "key must be lowercase letters, digits and underscores",
      });
    }
    if (seen.has(f.key)) {
      errors.push({ key: f.key, message: "duplicate field key" });
    }
    seen.add(f.key);

    if (f.type === "select" && !f.options?.length) {
      errors.push({ key: f.key, message: "select fields need options" });
    }
    if (f.min !== undefined && f.max !== undefined && f.min > f.max) {
      errors.push({ key: f.key, message: "min cannot exceed max" });
    }
  }
  return errors;
}

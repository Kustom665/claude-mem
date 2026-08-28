/**
 * Finance module: pay run arithmetic and sensitive-identifier handling.
 *
 * Owner/admin only — see `finance:*` and `payroll:*` in src/core/auth.ts, the
 * RLS policies in src/db/002_finance_ops.sql, and the `finance_suite` plan gate.
 *
 * All money is integer minor units. No floats: a cent lost to binary rounding
 * is a payroll discrepancy someone has to reconcile by hand.
 */

export interface PayLineInput {
  memberId: string;
  hours?: number;
  rateCents?: number;
  grossCents?: number;
  taxCents: number;
}

export interface PayLine {
  memberId: string;
  hours: number | null;
  rateCents: number | null;
  grossCents: number;
  taxCents: number;
  netCents: number;
}

export interface PayRunTotals {
  grossCents: number;
  taxCents: number;
  netCents: number;
}

export class PayRunError extends Error {
  constructor(message: string, readonly memberId?: string) {
    super(message);
    this.name = "PayRunError";
  }
}

/**
 * Gross for one line. Either an explicit amount (salary, bonus) or hours × rate.
 *
 * Rounding happens once, here, at the line. Totals are then summed from already
 * rounded lines so the run total always equals the sum of what each person is
 * actually paid — rounding the total separately would let the two disagree.
 */
export function lineGrossCents(input: PayLineInput): number {
  if (input.grossCents !== undefined) {
    if (!Number.isInteger(input.grossCents) || input.grossCents < 0) {
      throw new PayRunError("grossCents must be a non-negative integer", input.memberId);
    }
    return input.grossCents;
  }

  const { hours, rateCents } = input;
  if (hours === undefined || rateCents === undefined) {
    throw new PayRunError(
      "line needs either grossCents or both hours and rateCents",
      input.memberId,
    );
  }
  if (!Number.isFinite(hours) || hours < 0) {
    throw new PayRunError("hours must be non-negative", input.memberId);
  }
  if (!Number.isInteger(rateCents) || rateCents < 0) {
    throw new PayRunError("rateCents must be a non-negative integer", input.memberId);
  }

  // Half-up, matching how payroll is conventionally rounded in favour of the
  // worker. Math.round is half-up for positives and both operands are >= 0.
  return Math.round(hours * rateCents);
}

export function buildLine(input: PayLineInput): PayLine {
  const grossCents = lineGrossCents(input);

  if (!Number.isInteger(input.taxCents) || input.taxCents < 0) {
    throw new PayRunError("taxCents must be a non-negative integer", input.memberId);
  }
  if (input.taxCents > grossCents) {
    throw new PayRunError("tax cannot exceed gross pay", input.memberId);
  }

  return {
    memberId: input.memberId,
    hours: input.hours ?? null,
    rateCents: input.rateCents ?? null,
    grossCents,
    taxCents: input.taxCents,
    netCents: grossCents - input.taxCents,
  };
}

/** Build every line, rejecting a duplicate member before any total is computed. */
export function buildPayRun(inputs: readonly PayLineInput[]): {
  lines: PayLine[];
  totals: PayRunTotals;
} {
  const seen = new Set<string>();
  const lines: PayLine[] = [];

  for (const input of inputs) {
    if (seen.has(input.memberId)) {
      throw new PayRunError("member appears twice in one pay run", input.memberId);
    }
    seen.add(input.memberId);
    lines.push(buildLine(input));
  }

  return { lines, totals: totalsFor(lines) };
}

export function totalsFor(lines: readonly PayLine[]): PayRunTotals {
  const totals = lines.reduce<PayRunTotals>(
    (acc, l) => ({
      grossCents: acc.grossCents + l.grossCents,
      taxCents: acc.taxCents + l.taxCents,
      netCents: acc.netCents + l.netCents,
    }),
    { grossCents: 0, taxCents: 0, netCents: 0 },
  );

  // The database enforces this too; asserting here turns a silent accounting
  // discrepancy into an immediate, locatable failure.
  if (totals.netCents !== totals.grossCents - totals.taxCents) {
    throw new PayRunError("pay run totals do not reconcile");
  }
  return totals;
}

// ---------------------------------------------------------------------------
// Sensitive identifiers
// ---------------------------------------------------------------------------

/**
 * Last four digits of a tax identifier, for display.
 *
 * Screens and logs show only this; the full value stays encrypted at rest and
 * is decrypted solely when filing requires it.
 */
export function maskTaxId(taxId: string): string {
  const digits = taxId.replace(/\D/g, "");
  if (digits.length < 4) throw new PayRunError("tax id is too short to mask");
  return digits.slice(-4);
}

/** US EIN: nine digits, conventionally formatted NN-NNNNNNN. */
export function isValidEin(ein: string): boolean {
  return /^\d{2}-?\d{7}$/.test(ein.trim());
}

/**
 * Strip sensitive finance fields before anything is logged or sent to an error
 * reporter. Call at every logging boundary in the finance module.
 */
export function redactForLog<T extends Record<string, unknown>>(
  record: T,
): Record<string, unknown> {
  const SENSITIVE = new Set([
    "ein", "einEncrypted", "ein_encrypted",
    "stateTaxId", "state_tax_id", "stateTaxIdEncrypted", "state_tax_id_encrypted",
    "ssn", "taxId", "tax_id", "bankAccount", "bank_account", "routingNumber",
  ]);
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(record)) {
    out[k] = SENSITIVE.has(k) ? "[redacted]" : v;
  }
  return out;
}

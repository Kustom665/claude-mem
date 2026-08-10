/**
 * Money handling.
 *
 * Every monetary amount in this app is an integer number of cents. Floating
 * point dollars are never stored or summed — a notary's fee log feeds an
 * invoice and a tax report, and 0.1 + 0.2 problems there are real money.
 */

const CURRENCY_FORMATTER = new Intl.NumberFormat('en-US', {
  style: 'currency',
  currency: 'USD',
});

const PLAIN_FORMATTER = new Intl.NumberFormat('en-US', {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

/** `123456` → `"$1,234.56"` */
export function formatCents(cents: number | null | undefined): string {
  if (cents === null || cents === undefined || !Number.isFinite(cents)) return '—';
  return CURRENCY_FORMATTER.format(cents / 100);
}

/** `123456` → `"1,234.56"` — for table cells that already carry a currency header. */
export function formatCentsPlain(cents: number | null | undefined): string {
  if (cents === null || cents === undefined || !Number.isFinite(cents)) return '—';
  return PLAIN_FORMATTER.format(cents / 100);
}

/** `123456` → `"1234.56"` — for populating a number input. */
export function centsToInputValue(cents: number | null | undefined): string {
  if (cents === null || cents === undefined || !Number.isFinite(cents)) return '';
  return (cents / 100).toFixed(2);
}

/**
 * Parse user-entered money into cents.
 *
 * Accepts `$1,234.56`, `1234.56`, `1234`, `.5` and leading/trailing space.
 * Returns null for anything it cannot read, so callers can surface a field
 * error rather than silently storing a zero.
 */
export function parseMoneyToCents(input: string | number | null | undefined): number | null {
  if (input === null || input === undefined) return null;
  if (typeof input === 'number') {
    if (!Number.isFinite(input)) return null;
    return Math.round(input * 100);
  }

  const cleaned = input.trim().replace(/[$,\s]/g, '');
  if (cleaned === '') return null;

  const negative = cleaned.startsWith('-');
  const unsigned = negative ? cleaned.slice(1) : cleaned;
  if (!/^\d*(\.\d{0,})?$/.test(unsigned) || unsigned === '' || unsigned === '.') {
    return null;
  }

  const [whole, fraction = ''] = unsigned.split('.');
  // Round rather than truncate so "10.999" becomes 1100, not 1099.
  const wholeCents = Number(whole || '0') * 100;
  const fractionCents = fraction === '' ? 0 : Math.round(Number(`0.${fraction}`) * 100);
  const total = wholeCents + fractionCents;
  if (!Number.isFinite(total)) return null;

  return negative ? -total : total;
}

export function sumCents(values: readonly (number | null | undefined)[]): number {
  let total = 0;
  for (const value of values) {
    if (typeof value === 'number' && Number.isFinite(value)) total += value;
  }
  return total;
}

/** Mileage reimbursement, rounded to the nearest cent. */
export function mileageCents(miles: number, ratePerMileCents: number): number {
  if (!Number.isFinite(miles) || !Number.isFinite(ratePerMileCents)) return 0;
  return Math.round(miles * ratePerMileCents);
}

/** `70` → `"$0.70/mi"` */
export function formatMileageRate(ratePerMileCents: number): string {
  return `${formatCents(ratePerMileCents)}/mi`;
}

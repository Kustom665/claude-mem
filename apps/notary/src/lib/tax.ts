import { irsMileageRateCents } from './compliance';
import { sumCents } from './money';

/**
 * Income classification for tax reporting.
 *
 * The single most valuable number this app produces is the split between fees
 * earned for *performing notarial acts* and everything else. Fees for notarial
 * acts are reported as income on Schedule C but are **not** subject to
 * self-employment tax — the notary enters an adjustment on Schedule SE. Travel,
 * printing, document handling, administrative work and loan-signing service
 * fees do not qualify and remain fully SE-taxable.
 *
 * At the 2026 SE rate of 15.3%, a signing agent performing a few thousand
 * dollars of notarial acts a year is looking at a materially different tax
 * bill depending on whether those fees were tracked separately. Most notaries
 * lump everything into one "signing fee" line and lose the distinction, which
 * is why per-act fee capture in the journal — not the invoice — is the thing
 * that makes this report defensible.
 *
 * Sources:
 *   IRS Taxpayer Advocate, "Notarial Fees and Self-Employment Tax: Know What Is Exempt"
 *   https://www.taxpayeradvocate.irs.gov/news/tax-tips/notarial-fees-and-self-employment-tax-know-what-is-exempt/2026/07/
 *
 * This is a reporting aid, not tax advice. The output is designed to be handed
 * to a preparer, and the UI says so.
 */

/** Combined employer + employee self-employment tax rate. */
export const SE_TAX_RATE = 0.153;

/**
 * Portion of net earnings actually subject to SE tax (92.35%). Applied before
 * the rate, per Schedule SE.
 */
export const SE_NET_EARNINGS_FACTOR = 0.9235;

export type IncomeSplit = {
  /** Fees for performing notarial acts — exempt from self-employment tax. */
  notarialFeeCents: number;
  /** Travel, printing, handling, signing-service fees — SE-taxable. */
  nonNotarialFeeCents: number;
  totalCents: number;
};

export type JournalFeeRow = {
  feeChargedCents: number;
  travelFeeCents: number;
};

export type SigningFeeRow = {
  signingFeeCents: number;
  travelFeeCents: number;
  printFeeCents: number;
  additionalFeeCents: number;
};

/**
 * Split income for a period.
 *
 * Notarial fees come from the *journal*, because that is the only record that
 * ties a dollar amount to an actual notarial act. Signing fees come from the
 * signing record and are treated as non-notarial: a loan-signing fee pays for
 * presenting and handling the document package, which is service work, not the
 * notarial act itself.
 *
 * Journal travel fees are counted as non-notarial too — a travel fee is never
 * a fee for performing the act, whichever record it was entered on.
 */
export function splitIncome(
  journalRows: readonly JournalFeeRow[],
  signingRows: readonly SigningFeeRow[],
): IncomeSplit {
  const notarialFeeCents = sumCents(journalRows.map((row) => row.feeChargedCents));

  const journalTravel = sumCents(journalRows.map((row) => row.travelFeeCents));
  const signingNonNotarial = sumCents(
    signingRows.flatMap((row) => [
      row.signingFeeCents,
      row.travelFeeCents,
      row.printFeeCents,
      row.additionalFeeCents,
    ]),
  );

  const nonNotarialFeeCents = journalTravel + signingNonNotarial;

  return {
    notarialFeeCents,
    nonNotarialFeeCents,
    totalCents: notarialFeeCents + nonNotarialFeeCents,
  };
}

export type MileageRow = {
  date: Date | string;
  miles: number;
  /** Rate stored on the entry, used in preference to the IRS table. */
  ratePerMileCents?: number | null;
};

export type MileageSummary = {
  totalMiles: number;
  deductionCents: number;
  /** Per-rate breakdown, so a two-rate year is auditable. */
  byRate: Array<{ ratePerMileCents: number; miles: number; deductionCents: number }>;
};

/**
 * Total the mileage deduction, grouping by the rate in force.
 *
 * Each entry is valued at the rate stored on it when it was logged; entries
 * without one fall back to the IRS rate for that entry's date rather than
 * today's rate, so back-dated mileage is still valued correctly.
 */
export function summarizeMileage(rows: readonly MileageRow[]): MileageSummary {
  const buckets = new Map<number, { miles: number; deductionCents: number }>();
  let totalMiles = 0;

  for (const row of rows) {
    if (!Number.isFinite(row.miles) || row.miles <= 0) continue;

    const date = row.date instanceof Date ? row.date : new Date(row.date);
    const rate =
      row.ratePerMileCents && Number.isFinite(row.ratePerMileCents)
        ? row.ratePerMileCents
        : irsMileageRateCents(Number.isNaN(date.getTime()) ? new Date() : date);

    const existing = buckets.get(rate) ?? { miles: 0, deductionCents: 0 };
    existing.miles += row.miles;
    // Round once per bucket at the end rather than per row, so 100 trips of
    // 3.33 miles don't accumulate rounding drift.
    buckets.set(rate, existing);
    totalMiles += row.miles;
  }

  const byRate = [...buckets.entries()]
    .map(([ratePerMileCents, bucket]) => ({
      ratePerMileCents,
      miles: round2(bucket.miles),
      deductionCents: Math.round(bucket.miles * ratePerMileCents),
    }))
    .sort((a, b) => a.ratePerMileCents - b.ratePerMileCents);

  return {
    totalMiles: round2(totalMiles),
    deductionCents: sumCents(byRate.map((bucket) => bucket.deductionCents)),
    byRate,
  };
}

export type TaxSummary = {
  income: IncomeSplit;
  mileage: MileageSummary;
  otherExpenseCents: number;
  /** Schedule C bottom line: all income less all deductions. */
  netProfitCents: number;
  /**
   * Net profit less the notarial exemption — the figure that flows to
   * Schedule SE. Floored at zero: a negative base produces no SE tax.
   */
  seTaxableBaseCents: number;
  estimatedSeTaxCents: number;
  /**
   * What the SE tax would have been without separating notarial fees. The
   * difference is the value the notary gets from keeping this journal.
   */
  seTaxWithoutExemptionCents: number;
  estimatedSavingsCents: number;
};

/**
 * Build the year-end tax picture.
 *
 * The exemption reduces the SE base, not the income total — notarial fees are
 * still reported as income on Schedule C. Deductions are applied against total
 * income first, and the exemption is then subtracted from what remains, which
 * is the ordering the Schedule SE adjustment follows.
 */
export function summarizeTax(
  income: IncomeSplit,
  mileage: MileageSummary,
  otherExpenseCents = 0,
): TaxSummary {
  const deductionsCents = mileage.deductionCents + otherExpenseCents;
  const netProfitCents = income.totalCents - deductionsCents;

  const seTaxableBaseCents = Math.max(0, netProfitCents - income.notarialFeeCents);
  const estimatedSeTaxCents = seTaxOn(seTaxableBaseCents);
  const seTaxWithoutExemptionCents = seTaxOn(Math.max(0, netProfitCents));

  return {
    income,
    mileage,
    otherExpenseCents,
    netProfitCents,
    seTaxableBaseCents,
    estimatedSeTaxCents,
    seTaxWithoutExemptionCents,
    estimatedSavingsCents: Math.max(0, seTaxWithoutExemptionCents - estimatedSeTaxCents),
  };
}

function seTaxOn(baseCents: number): number {
  if (baseCents <= 0) return 0;
  return Math.round(baseCents * SE_NET_EARNINGS_FACTOR * SE_TAX_RATE);
}

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

export const TAX_DISCLAIMER =
  'This report is a bookkeeping aid, not tax advice. Fees for performing notarial acts are ' +
  'generally exempt from self-employment tax, but the exemption depends on facts this app cannot ' +
  'verify. Hand these figures to your tax preparer rather than filing from them directly.';

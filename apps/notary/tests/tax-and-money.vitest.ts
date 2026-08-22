import { describe, expect, it } from 'vitest';
import {
  centsToInputValue,
  formatCents,
  mileageCents,
  parseMoneyToCents,
  sumCents,
} from '../src/lib/money';
import { splitIncome, summarizeMileage, summarizeTax, SE_TAX_RATE } from '../src/lib/tax';
import { irsMileageRateCents } from '../src/lib/compliance';
import { formatInvoiceNumber, parseInvoiceNumber } from '../src/lib/invoicing';
import { toCsv } from '../src/lib/csv';

describe('parseMoneyToCents', () => {
  it('reads the formats a person actually types', () => {
    expect(parseMoneyToCents('15')).toBe(1500);
    expect(parseMoneyToCents('15.00')).toBe(1500);
    expect(parseMoneyToCents('$15.00')).toBe(1500);
    expect(parseMoneyToCents(' $1,234.56 ')).toBe(123456);
    expect(parseMoneyToCents('.5')).toBe(50);
    expect(parseMoneyToCents('0')).toBe(0);
  });

  it('rounds sub-cent input rather than truncating', () => {
    expect(parseMoneyToCents('10.999')).toBe(1100);
    expect(parseMoneyToCents('10.994')).toBe(1099);
  });

  it('rejects what it cannot read instead of silently storing zero', () => {
    expect(parseMoneyToCents('')).toBeNull();
    expect(parseMoneyToCents('abc')).toBeNull();
    expect(parseMoneyToCents('.')).toBeNull();
    expect(parseMoneyToCents('1.2.3')).toBeNull();
    expect(parseMoneyToCents(null)).toBeNull();
  });

  it('round-trips through the input formatter', () => {
    for (const cents of [0, 5, 500, 1999, 123456]) {
      expect(parseMoneyToCents(centsToInputValue(cents))).toBe(cents);
    }
  });
});

describe('formatCents', () => {
  it('formats and handles absence', () => {
    expect(formatCents(1500)).toBe('$15.00');
    expect(formatCents(0)).toBe('$0.00');
    expect(formatCents(null)).toBe('—');
  });
});

describe('sumCents', () => {
  it('ignores nulls and non-finite values', () => {
    expect(sumCents([100, null, 250, undefined, Number.NaN])).toBe(350);
  });
});

describe('irsMileageRateCents', () => {
  it('uses the rate in force on the date, including the mid-2026 change', () => {
    // The IRS set 72.5c effective 1 Jan 2026 and raised it to 76c on 1 Jul.
    expect(irsMileageRateCents(new Date('2026-03-15'))).toBe(72.5);
    expect(irsMileageRateCents(new Date('2026-06-30'))).toBe(72.5);
    expect(irsMileageRateCents(new Date('2026-07-01'))).toBe(76);
    expect(irsMileageRateCents(new Date('2026-11-02'))).toBe(76);
    expect(irsMileageRateCents(new Date('2025-05-01'))).toBe(70);
  });
});

describe('summarizeMileage', () => {
  it('buckets by rate so a two-rate year stays auditable', () => {
    const summary = summarizeMileage([
      { date: new Date('2026-02-01'), miles: 100 },
      { date: new Date('2026-08-01'), miles: 100 },
    ]);

    expect(summary.totalMiles).toBe(200);
    expect(summary.byRate).toHaveLength(2);
    // 100 * 72.5c = $72.50, 100 * 76c = $76.00
    expect(summary.deductionCents).toBe(7250 + 7600);
  });

  it('prefers the rate stored on the entry over the IRS table', () => {
    const summary = summarizeMileage([
      { date: new Date('2026-08-01'), miles: 10, ratePerMileCents: 50 },
    ]);
    expect(summary.deductionCents).toBe(500);
  });

  it('skips zero and negative distances', () => {
    const summary = summarizeMileage([
      { date: new Date('2026-08-01'), miles: 0 },
      { date: new Date('2026-08-01'), miles: -5 },
      { date: new Date('2026-08-01'), miles: 10, ratePerMileCents: 100 },
    ]);
    expect(summary.totalMiles).toBe(10);
    expect(summary.deductionCents).toBe(1000);
  });

  it('avoids per-row rounding drift', () => {
    // 100 trips of 3.33 miles at 76c: rounding each row would drift.
    const rows = Array.from({ length: 100 }, () => ({
      date: new Date('2026-08-01'),
      miles: 3.33,
      ratePerMileCents: 76,
    }));
    // 333 miles * 76c = 25308c exactly.
    expect(summarizeMileage(rows).deductionCents).toBe(25308);
  });
});

describe('splitIncome', () => {
  it('separates notarial fees from everything else', () => {
    const income = splitIncome(
      [
        { feeChargedCents: 500, travelFeeCents: 0 },
        { feeChargedCents: 500, travelFeeCents: 4500 },
      ],
      [
        {
          signingFeeCents: 17500,
          travelFeeCents: 2000,
          printFeeCents: 2500,
          additionalFeeCents: 0,
        },
      ],
    );

    // Only the per-act fees are exempt.
    expect(income.notarialFeeCents).toBe(1000);
    // Journal travel + all signing-side fees are not.
    expect(income.nonNotarialFeeCents).toBe(4500 + 17500 + 2000 + 2500);
    expect(income.totalCents).toBe(income.notarialFeeCents + income.nonNotarialFeeCents);
  });

  it('treats a loan signing fee as SE-taxable service income', () => {
    const income = splitIncome(
      [],
      [
        {
          signingFeeCents: 15000,
          travelFeeCents: 0,
          printFeeCents: 0,
          additionalFeeCents: 0,
        },
      ],
    );
    expect(income.notarialFeeCents).toBe(0);
    expect(income.nonNotarialFeeCents).toBe(15000);
  });
});

describe('summarizeTax', () => {
  it('applies the exemption to the SE base, not to income', () => {
    const income = splitIncome(
      [{ feeChargedCents: 10000, travelFeeCents: 0 }],
      [
        {
          signingFeeCents: 90000,
          travelFeeCents: 0,
          printFeeCents: 0,
          additionalFeeCents: 0,
        },
      ],
    );
    const mileage = summarizeMileage([]);
    const summary = summarizeTax(income, mileage);

    expect(summary.netProfitCents).toBe(100000);
    // Notarial fees come out of the SE base only.
    expect(summary.seTaxableBaseCents).toBe(90000);
    expect(summary.estimatedSeTaxCents).toBe(Math.round(90000 * 0.9235 * SE_TAX_RATE));
    expect(summary.estimatedSavingsCents).toBeGreaterThan(0);
  });

  it('never produces a negative SE base', () => {
    const income = splitIncome([{ feeChargedCents: 5000, travelFeeCents: 0 }], []);
    const mileage = summarizeMileage([
      { date: new Date('2026-08-01'), miles: 1000, ratePerMileCents: 76 },
    ]);
    const summary = summarizeTax(income, mileage);

    expect(summary.netProfitCents).toBeLessThan(0);
    expect(summary.seTaxableBaseCents).toBe(0);
    expect(summary.estimatedSeTaxCents).toBe(0);
    expect(summary.estimatedSavingsCents).toBe(0);
  });

  it('reports no saving when there were no notarial fees', () => {
    const income = splitIncome(
      [],
      [{ signingFeeCents: 50000, travelFeeCents: 0, printFeeCents: 0, additionalFeeCents: 0 }],
    );
    const summary = summarizeTax(income, summarizeMileage([]));
    expect(summary.estimatedSavingsCents).toBe(0);
  });
});

describe('mileageCents', () => {
  it('rounds to the nearest cent', () => {
    expect(mileageCents(18.4, 76)).toBe(1398);
    expect(mileageCents(0, 76)).toBe(0);
  });
});

describe('invoice numbering', () => {
  it('formats with zero padding', () => {
    expect(formatInvoiceNumber('KMN', 1)).toBe('KMN-0001');
    expect(formatInvoiceNumber('INV', 42)).toBe('INV-0042');
    expect(formatInvoiceNumber('INV', 12345)).toBe('INV-12345');
  });

  it('parses back only its own prefix', () => {
    expect(parseInvoiceNumber('KMN', 'KMN-0007')).toBe(7);
    expect(parseInvoiceNumber('KMN', 'INV-0007')).toBeNull();
    expect(parseInvoiceNumber('KMN', 'KMN-abc')).toBeNull();
  });

  it('treats a regex-special prefix literally', () => {
    expect(parseInvoiceNumber('A.B', 'A.B-0003')).toBe(3);
    expect(parseInvoiceNumber('A.B', 'AXB-0003')).toBeNull();
  });
});

describe('toCsv', () => {
  it('quotes fields containing separators', () => {
    const csv = toCsv(['a', 'b'], [['plain', 'has,comma']]);
    expect(csv).toContain('plain,"has,comma"');
  });

  it('escapes embedded quotes', () => {
    const csv = toCsv(['a'], [['say "hi"']]);
    expect(csv).toContain('"say ""hi"""');
  });

  it('neutralises formula injection', () => {
    // A signer named "=cmd|..." must not execute when the export is opened.
    const csv = toCsv(['name'], [['=1+1'], ['+x'], ['-y'], ['@z']]);
    expect(csv).toContain("'=1+1");
    expect(csv).toContain("'+x");
    expect(csv).toContain("'-y");
    expect(csv).toContain("'@z");
  });
});

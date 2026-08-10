import 'server-only';

import type { Prisma } from '@/generated/prisma';
import { prisma } from './db';
import { formatCents } from './money';
import { formatDate } from './dates';

/**
 * Invoice assembly.
 *
 * Numbers are sequential per notary. The sequence is derived from the highest
 * existing number rather than a counter column, so importing historical
 * invoices does not require resetting anything, and a deleted draft does not
 * leave a hole that a later invoice silently reuses.
 */

const NUMBER_PAD = 4;

export function parseInvoiceNumber(prefix: string, number: string): number | null {
  const escaped = prefix.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const match = number.match(new RegExp(`^${escaped}-(\\d+)$`));
  if (!match) return null;
  const value = Number(match[1]);
  return Number.isInteger(value) ? value : null;
}

export function formatInvoiceNumber(prefix: string, sequence: number): string {
  return `${prefix}-${String(sequence).padStart(NUMBER_PAD, '0')}`;
}

/**
 * The next unused invoice number for a notary.
 *
 * Call inside the same transaction as the insert; the `@@unique([userId,
 * number])` constraint is the real guard against a race.
 */
export async function nextInvoiceNumber(
  tx: Prisma.TransactionClient,
  userId: string,
  prefix: string,
): Promise<string> {
  const existing = await tx.invoice.findMany({
    where: { userId },
    select: { number: true },
  });

  let highest = 0;
  for (const invoice of existing) {
    const sequence = parseInvoiceNumber(prefix, invoice.number);
    if (sequence !== null && sequence > highest) highest = sequence;
  }

  return formatInvoiceNumber(prefix, highest + 1);
}

export type DraftLineItem = {
  description: string;
  quantity: number;
  unitAmountCents: number;
  amountCents: number;
  sortOrder: number;
};

type BillableSigning = {
  id: string;
  title: string;
  scheduledAt: Date;
  signingFeeCents: number;
  travelFeeCents: number;
  printFeeCents: number;
  additionalFeeCents: number;
  journalEntries: Array<{ feeChargedCents: number; documentType: string }>;
};

/**
 * Turn completed signings into invoice lines.
 *
 * Notarial fees are listed separately from service fees rather than rolled into
 * one number. That is partly for the client's benefit — Pennsylvania requires
 * non-notarial charges to be itemised — and partly for the notary's, because
 * the split is what supports the self-employment tax exemption at year end.
 */
export function buildLineItems(
  signings: readonly BillableSigning[],
  timezone: string,
): DraftLineItem[] {
  const items: DraftLineItem[] = [];
  let order = 0;

  for (const signing of signings) {
    const dated = `${signing.title} — ${formatDate(signing.scheduledAt, timezone)}`;

    const notarialCents = signing.journalEntries.reduce(
      (total, entry) => total + entry.feeChargedCents,
      0,
    );

    if (notarialCents > 0) {
      const count = signing.journalEntries.filter((entry) => entry.feeChargedCents > 0).length;
      items.push({
        description: `${dated} — notarial acts (${count})`,
        quantity: 1,
        unitAmountCents: notarialCents,
        amountCents: notarialCents,
        sortOrder: (order += 10),
      });
    }

    if (signing.signingFeeCents > 0) {
      items.push({
        description: `${dated} — signing service fee`,
        quantity: 1,
        unitAmountCents: signing.signingFeeCents,
        amountCents: signing.signingFeeCents,
        sortOrder: (order += 10),
      });
    }

    if (signing.travelFeeCents > 0) {
      items.push({
        description: `${dated} — travel`,
        quantity: 1,
        unitAmountCents: signing.travelFeeCents,
        amountCents: signing.travelFeeCents,
        sortOrder: (order += 10),
      });
    }

    if (signing.printFeeCents > 0) {
      items.push({
        description: `${dated} — document printing`,
        quantity: 1,
        unitAmountCents: signing.printFeeCents,
        amountCents: signing.printFeeCents,
        sortOrder: (order += 10),
      });
    }

    if (signing.additionalFeeCents > 0) {
      items.push({
        description: `${dated} — additional charges`,
        quantity: 1,
        unitAmountCents: signing.additionalFeeCents,
        amountCents: signing.additionalFeeCents,
        sortOrder: (order += 10),
      });
    }
  }

  return items;
}

export function sumLineItems(items: readonly DraftLineItem[]): number {
  return items.reduce((total, item) => total + item.amountCents, 0);
}

/** Recompute an invoice's stored totals from its line items. */
export async function recalculateInvoice(invoiceId: string): Promise<void> {
  const invoice = await prisma.invoice.findUnique({
    where: { id: invoiceId },
    select: { taxCents: true, amountPaidCents: true, status: true, lineItems: true },
  });
  if (!invoice) return;

  const subtotalCents = invoice.lineItems.reduce((total, item) => total + item.amountCents, 0);
  const totalCents = subtotalCents + invoice.taxCents;

  // Keep the status honest about what has actually been paid.
  let status = invoice.status;
  if (status !== 'DRAFT' && status !== 'VOID') {
    if (invoice.amountPaidCents >= totalCents && totalCents > 0) status = 'PAID';
    else if (invoice.amountPaidCents > 0) status = 'PARTIAL';
    else status = 'SENT';
  }

  await prisma.invoice.update({
    where: { id: invoiceId },
    data: { subtotalCents, totalCents, status },
  });
}

export function invoiceBalanceCents(invoice: {
  totalCents: number;
  amountPaidCents: number;
}): number {
  return invoice.totalCents - invoice.amountPaidCents;
}

export function describeBalance(invoice: {
  totalCents: number;
  amountPaidCents: number;
}): string {
  const balance = invoiceBalanceCents(invoice);
  if (balance <= 0) return 'Paid in full';
  if (invoice.amountPaidCents > 0) return `${formatCents(balance)} outstanding`;
  return `${formatCents(balance)} due`;
}

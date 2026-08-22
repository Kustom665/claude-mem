'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { requireUser } from '@/lib/auth';
import { prisma } from '@/lib/db';
import { buildLineItems, nextInvoiceNumber, sumLineItems } from '@/lib/invoicing';
import { dispatchEvent } from '@/lib/webhooks';
import { addDays } from '@/lib/dates';
import {
  feeScheduleSchema,
  formDataToObject,
  invoicePaymentSchema,
  mileageSchema,
  toFieldErrors,
  type FieldErrors,
} from '@/lib/validation';

export type BillingFormState = { errors: FieldErrors } | null;

// ---------------------------------------------------------------------------
// Invoices
// ---------------------------------------------------------------------------

/**
 * Create an invoice from a client's completed, unbilled signings.
 *
 * The signings are stamped with the invoice id inside the same transaction, so
 * two people hitting the button at once cannot bill the same work twice.
 */
export async function createInvoiceFromSigningsAction(
  _prev: BillingFormState,
  formData: FormData,
): Promise<BillingFormState> {
  const user = await requireUser();
  const clientId = String(formData.get('clientId') ?? '');
  const selected = formData.getAll('signingIds').map(String).filter(Boolean);

  if (!clientId) return { errors: { clientId: 'Choose a client.' } };
  if (selected.length === 0) {
    return { errors: { _form: 'Select at least one signing to invoice.' } };
  }

  const client = await prisma.client.findFirst({
    where: { id: clientId, userId: user.id },
    select: { id: true, paymentTermsDays: true },
  });
  if (!client) return { errors: { clientId: 'That client no longer exists.' } };

  let invoiceId: string;
  try {
    const invoice = await prisma.$transaction(async (tx) => {
      const signings = await tx.signing.findMany({
        where: {
          id: { in: selected },
          userId: user.id,
          clientId: client.id,
          status: 'COMPLETED',
          invoiceId: null,
        },
        orderBy: { scheduledAt: 'asc' },
        include: {
          journalEntries: { select: { feeChargedCents: true, documentType: true } },
        },
      });

      if (signings.length === 0) {
        throw new Error('Those signings have already been invoiced.');
      }

      const lineItems = buildLineItems(signings, user.timezone);
      const subtotalCents = sumLineItems(lineItems);
      const number = await nextInvoiceNumber(tx, user.id, user.invoicePrefix);
      const issueDate = new Date();

      const created = await tx.invoice.create({
        data: {
          userId: user.id,
          clientId: client.id,
          number,
          status: 'DRAFT',
          issueDate,
          dueDate: addDays(issueDate, client.paymentTermsDays || user.invoiceTermsDays),
          subtotalCents,
          totalCents: subtotalCents,
          terms: `Net ${client.paymentTermsDays || user.invoiceTermsDays}`,
          lineItems: { createMany: { data: lineItems } },
        },
        select: { id: true },
      });

      await tx.signing.updateMany({
        where: { id: { in: signings.map((signing) => signing.id) } },
        data: { invoiceId: created.id },
      });

      return created;
    });
    invoiceId = invoice.id;
  } catch (error) {
    return {
      errors: {
        _form: error instanceof Error ? error.message : 'Could not create the invoice.',
      },
    };
  }

  revalidatePath('/billing');
  redirect(`/billing/invoices/${invoiceId}`);
}

export async function setInvoiceStatusAction(
  invoiceId: string,
  status: 'DRAFT' | 'SENT' | 'PAID' | 'VOID',
): Promise<void> {
  const user = await requireUser();

  const invoice = await prisma.invoice.findFirst({
    where: { id: invoiceId, userId: user.id },
    include: { client: { select: { name: true, email: true } } },
  });
  if (!invoice) return;

  const data: Record<string, unknown> = { status };
  if (status === 'SENT' && !invoice.sentAt) data.sentAt = new Date();
  if (status === 'PAID') {
    data.paidAt = new Date();
    data.amountPaidCents = invoice.totalCents;
  }
  if (status === 'DRAFT') {
    data.sentAt = null;
    data.paidAt = null;
  }

  await prisma.invoice.update({ where: { id: invoice.id }, data });

  if (status === 'SENT' || status === 'PAID') {
    await dispatchEvent(user.id, status === 'SENT' ? 'invoice.sent' : 'invoice.paid', {
      invoiceId: invoice.id,
      number: invoice.number,
      clientName: invoice.client.name,
      clientEmail: invoice.client.email,
      totalCents: invoice.totalCents,
      dueDate: invoice.dueDate.toISOString(),
    });
  }

  revalidatePath('/billing');
  revalidatePath(`/billing/invoices/${invoiceId}`);
}

export async function recordPaymentAction(
  invoiceId: string,
  _prev: BillingFormState,
  formData: FormData,
): Promise<BillingFormState> {
  const user = await requireUser();

  const parsed = invoicePaymentSchema.safeParse(formDataToObject(formData));
  if (!parsed.success) return { errors: toFieldErrors(parsed.error) };

  const invoice = await prisma.invoice.findFirst({
    where: { id: invoiceId, userId: user.id },
    include: { client: { select: { name: true, email: true } } },
  });
  if (!invoice) return { errors: { _form: 'That invoice no longer exists.' } };

  const amountPaidCents = parsed.data.amountPaidCents;
  const fullyPaid = amountPaidCents >= invoice.totalCents && invoice.totalCents > 0;

  await prisma.invoice.update({
    where: { id: invoice.id },
    data: {
      amountPaidCents,
      paidAt: fullyPaid ? (parsed.data.paidAt ?? new Date()) : null,
      status: invoice.status === 'VOID' ? 'VOID' : fullyPaid ? 'PAID' : amountPaidCents > 0 ? 'PARTIAL' : 'SENT',
    },
  });

  if (fullyPaid) {
    await dispatchEvent(user.id, 'invoice.paid', {
      invoiceId: invoice.id,
      number: invoice.number,
      clientName: invoice.client.name,
      clientEmail: invoice.client.email,
      totalCents: invoice.totalCents,
    });
  }

  revalidatePath('/billing');
  revalidatePath(`/billing/invoices/${invoiceId}`);
  return null;
}

// ---------------------------------------------------------------------------
// Mileage
// ---------------------------------------------------------------------------

export async function createMileageAction(
  _prev: BillingFormState,
  formData: FormData,
): Promise<BillingFormState> {
  const user = await requireUser();

  const parsed = mileageSchema.safeParse(formDataToObject(formData));
  if (!parsed.success) return { errors: toFieldErrors(parsed.error) };

  const { signingId, ...rest } = parsed.data;

  const ownedSigningId = signingId
    ? (
        await prisma.signing.findFirst({
          where: { id: signingId, userId: user.id },
          select: { id: true },
        })
      )?.id ?? null
    : null;

  await prisma.mileageEntry.create({
    data: { ...rest, signingId: ownedSigningId, userId: user.id },
  });

  revalidatePath('/billing/mileage');
  revalidatePath('/reports');
  return null;
}

export async function deleteMileageAction(entryId: string): Promise<void> {
  const user = await requireUser();
  await prisma.mileageEntry.deleteMany({ where: { id: entryId, userId: user.id } });
  revalidatePath('/billing/mileage');
  revalidatePath('/reports');
}

// ---------------------------------------------------------------------------
// Fee schedule
// ---------------------------------------------------------------------------

export async function createFeeItemAction(
  _prev: BillingFormState,
  formData: FormData,
): Promise<BillingFormState> {
  const user = await requireUser();

  const parsed = feeScheduleSchema.safeParse(formDataToObject(formData));
  if (!parsed.success) return { errors: toFieldErrors(parsed.error) };

  await prisma.feeScheduleItem.create({ data: { ...parsed.data, userId: user.id } });

  revalidatePath('/billing/fees');
  return null;
}

export async function deleteFeeItemAction(itemId: string): Promise<void> {
  const user = await requireUser();
  await prisma.feeScheduleItem.deleteMany({ where: { id: itemId, userId: user.id } });
  revalidatePath('/billing/fees');
}

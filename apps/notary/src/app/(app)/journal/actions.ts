'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { requireUser } from '@/lib/auth';
import { appendJournalEntry } from '@/lib/journal';
import { assessThumbprint, checkFeeAgainstStateMax } from '@/lib/compliance';
import { dispatchEvent } from '@/lib/webhooks';
import { formatCents } from '@/lib/money';
import {
  formDataToObject,
  journalEntrySchema,
  toFieldErrors,
  type FieldErrors,
} from '@/lib/validation';

export type JournalFormState = { errors: FieldErrors } | null;

/**
 * Record a notarial act.
 *
 * Compliance checks run here, not only in the browser, because the rules are
 * the product. A form posted with JavaScript disabled — or by anything other
 * than our own form — has to hit the same gate.
 */
export async function createJournalEntryAction(
  _prev: JournalFormState,
  formData: FormData,
): Promise<JournalFormState> {
  const user = await requireUser();

  const parsed = journalEntrySchema.safeParse(formDataToObject(formData));
  if (!parsed.success) {
    return { errors: toFieldErrors(parsed.error) };
  }

  const input = parsed.data;
  const errors: FieldErrors = {};

  // A notarisation performed on an expired commission is void. Refuse to write
  // it rather than record an act the notary had no authority to perform.
  if (
    user.commissionExpiresOn &&
    input.performedAt.getTime() > user.commissionExpiresOn.getTime()
  ) {
    errors._form =
      'Your commission had expired on the date of this act. A notarial act performed on an ' +
      'expired commission is void — correct your commission dates in settings before recording it.';
  }

  const thumbprint = assessThumbprint(
    input.documentType,
    input.documentDescription,
    user.commissionState,
  );

  if (thumbprint.required && !input.thumbprintTaken) {
    errors.thumbprintTaken =
      thumbprint.reason ?? 'This document requires the signer’s thumbprint in your journal.';
  }

  // Pennsylvania prohibits recording biometrics in the journal entirely.
  if (thumbprint.prohibited && input.thumbprintTaken) {
    errors.thumbprintTaken =
      thumbprint.reason ?? 'Your state prohibits recording biometrics in the journal.';
  }

  const feeCheck = checkFeeAgainstStateMax(
    input.feeChargedCents,
    input.actType,
    user.commissionState,
    input.notarizedRemotely,
  );

  if (feeCheck?.overMax) {
    errors.feeChargedCents =
      `${user.commissionState} caps this act at ${formatCents(feeCheck.maxCents)}. ` +
      'Charging above the statutory maximum is a violation — bill the excess as a separate, ' +
      'disclosed non-notarial fee instead.';
  }

  if (Object.keys(errors).length > 0) {
    return { errors };
  }

  const result = await appendJournalEntry(user.id, input);
  if (!result.ok) {
    return { errors: { _form: result.error } };
  }

  await dispatchEvent(user.id, 'journal.entry_created', {
    entryId: result.entry.id,
    sequenceNumber: result.entry.sequenceNumber,
    actType: result.entry.actType,
    documentType: result.entry.documentType,
    signerName: result.entry.signerName,
    performedAt: result.entry.performedAt.toISOString(),
    feeChargedCents: result.entry.feeChargedCents,
  });

  revalidatePath('/journal');
  revalidatePath('/dashboard');
  redirect(`/journal/${result.entry.id}?created=1`);
}

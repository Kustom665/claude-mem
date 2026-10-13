'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { requireUser } from '@/lib/auth';
import { prisma } from '@/lib/db';
import { isUniqueViolation } from '@/lib/db-errors';
import {
  PIPELINE_OPEN_STATUSES,
  REQUEST_SERVICE_LABELS,
  REQUEST_SERVICE_TO_SIGNING_TYPE,
  type PipelineStatus,
  type RequestService,
} from '@/lib/domain';
import {
  clientTypeForCategory,
  statusTransitionDates,
  suggestFollowUp,
} from '@/lib/pipeline';
import { proposedStart, requestNote } from '@/lib/requests';
import { REQUIREMENT_KEYS, REQUIREMENTS, serializeRequirementList } from '@/lib/requirements';
import {
  formDataToObject,
  sourceApplicationSchema,
  toFieldErrors,
  type FieldErrors,
} from '@/lib/validation';
import { dispatchEvent } from '@/lib/webhooks';
import { workSourceByKey } from '@/lib/work-sources';

export type ApplicationFormState = { errors: FieldErrors; saved?: boolean } | null;

function revalidatePipeline(id?: string): void {
  revalidatePath('/find-work');
  revalidatePath('/find-work/pipeline');
  revalidatePath('/dashboard');
  if (id) revalidatePath(`/find-work/pipeline/${id}`);
}

// ---------------------------------------------------------------------------
// Pipeline
// ---------------------------------------------------------------------------

/** Start tracking a source from the directory. Idempotent. */
export async function trackSourceAction(sourceKey: string): Promise<void> {
  const user = await requireUser();

  const source = workSourceByKey(sourceKey);
  if (!source) return;

  const existing = await prisma.sourceApplication.findFirst({
    where: { userId: user.id, sourceKey },
    select: { id: true },
  });
  if (existing) redirect(`/find-work/pipeline/${existing.id}`);

  let createdId: string;
  try {
    const created = await prisma.sourceApplication.create({
      data: {
        userId: user.id,
        sourceKey,
        name: source.name,
        category: source.category,
        website: source.applyUrl,
      },
      select: { id: true },
    });
    createdId = created.id;
  } catch (error) {
    // A double-click raced us to the unique index. Land on the one that won.
    if (!isUniqueViolation(error)) throw error;
    const winner = await prisma.sourceApplication.findFirst({
      where: { userId: user.id, sourceKey },
      select: { id: true },
    });
    if (!winner) throw error;
    createdId = winner.id;
  }

  revalidatePipeline();
  redirect(`/find-work/pipeline/${createdId}`);
}

/** A prospect the notary found themselves: a local title office, a law firm. */
export async function createProspectAction(
  _prev: ApplicationFormState,
  formData: FormData,
): Promise<ApplicationFormState> {
  const user = await requireUser();

  const parsed = sourceApplicationSchema.safeParse(formDataToObject(formData, user.timezone));
  if (!parsed.success) return { errors: toFieldErrors(parsed.error) };

  const data = parsed.data;
  const dates = statusTransitionDates(null, data.status, {
    appliedOn: data.appliedOn,
    approvedOn: null,
  });

  const created = await prisma.sourceApplication.create({
    data: {
      ...data,
      ...dates,
      nextFollowUpOn:
        data.nextFollowUpOn ??
        (PIPELINE_OPEN_STATUSES.has(data.status)
          ? suggestFollowUp(data.status, user.timezone)
          : null),
      userId: user.id,
    },
    select: { id: true },
  });

  revalidatePipeline();
  redirect(`/find-work/pipeline/${created.id}`);
}

export async function updateApplicationAction(
  applicationId: string,
  _prev: ApplicationFormState,
  formData: FormData,
): Promise<ApplicationFormState> {
  const user = await requireUser();

  const parsed = sourceApplicationSchema.safeParse(formDataToObject(formData, user.timezone));
  if (!parsed.success) return { errors: toFieldErrors(parsed.error) };

  const existing = await prisma.sourceApplication.findFirst({
    where: { id: applicationId, userId: user.id },
  });
  if (!existing) return { errors: { _form: 'That entry no longer exists.' } };

  const data = parsed.data;
  const statusChanged = existing.status !== data.status;

  const dates = statusTransitionDates(
    existing.status,
    data.status,
    {
      appliedOn: data.appliedOn ?? existing.appliedOn,
      approvedOn: existing.approvedOn,
    },
  );

  // A status that is waiting on an answer needs a follow-up date, or the entry
  // quietly rots. Offer one when the notary moves it forward without choosing.
  // A status with nothing left to chase carries none.
  let nextFollowUpOn = data.nextFollowUpOn;
  if (!PIPELINE_OPEN_STATUSES.has(data.status as PipelineStatus)) {
    nextFollowUpOn = null;
  } else if (!nextFollowUpOn && (statusChanged || !existing.nextFollowUpOn)) {
    nextFollowUpOn = suggestFollowUp(data.status, user.timezone);
  }

  // updateMany scoped by userId: a forged id updates zero rows.
  const result = await prisma.sourceApplication.updateMany({
    where: { id: applicationId, userId: user.id },
    data: { ...data, ...dates, nextFollowUpOn },
  });
  if (result.count === 0) return { errors: { _form: 'That entry no longer exists.' } };

  revalidatePipeline(applicationId);
  return { errors: {}, saved: true };
}

/**
 * Save the things the app cannot see: a certification held with a third party,
 * a W-9 in a folder. Only the manual requirements can be ticked — an automatic
 * one is computed from the credentials in Settings and ignores this list — so
 * anything else posted here is dropped rather than stored.
 */
export async function saveChecklistAction(formData: FormData): Promise<void> {
  const user = await requireUser();

  const ticked = REQUIREMENT_KEYS.filter(
    (key) => REQUIREMENTS[key].kind === 'MANUAL' && formData.get(`req_${key}`) === 'on',
  );

  await prisma.user.update({
    where: { id: user.id },
    data: { readinessChecklist: serializeRequirementList(ticked) },
  });

  revalidatePipeline();
}

export async function deleteApplicationAction(applicationId: string): Promise<void> {
  const user = await requireUser();
  await prisma.sourceApplication.deleteMany({ where: { id: applicationId, userId: user.id } });
  revalidatePipeline();
  redirect('/find-work/pipeline');
}

/**
 * The source has started sending work, so it becomes a client — the record
 * signings and invoices hang off.
 */
export async function convertToClientAction(applicationId: string): Promise<void> {
  const user = await requireUser();

  const application = await prisma.sourceApplication.findFirst({
    where: { id: applicationId, userId: user.id },
  });
  if (!application) return;
  if (application.clientId) redirect(`/clients/${application.clientId}`);

  const client = await prisma.client.create({
    data: {
      userId: user.id,
      name: application.name,
      type: clientTypeForCategory(application.category),
      contactName: application.contactName,
      email: application.contactEmail,
      phone: application.contactPhone,
      notes: 'Added from your Find Work pipeline.',
    },
  });

  const dates = statusTransitionDates(application.status, 'ACTIVE', {
    appliedOn: application.appliedOn,
    approvedOn: application.approvedOn,
  });

  await prisma.sourceApplication.updateMany({
    where: { id: applicationId, userId: user.id },
    data: { clientId: client.id, status: 'ACTIVE', nextFollowUpOn: null, ...dates },
  });

  await dispatchEvent(user.id, 'client.created', {
    clientId: client.id,
    name: client.name,
    type: client.type,
    email: client.email,
    phone: client.phone,
    contactName: client.contactName,
  });

  revalidatePipeline(applicationId);
  revalidatePath('/clients');
  redirect(`/clients/${client.id}`);
}

// ---------------------------------------------------------------------------
// Inbound requests
// ---------------------------------------------------------------------------

const REQUEST_STATUS_CHANGES = new Set(['NEW', 'CONTACTED', 'DECLINED', 'SPAM']);

function revalidateRequests(): void {
  revalidatePath('/find-work/requests');
  revalidatePath('/find-work');
  revalidatePath('/dashboard');
}

/**
 * Move a request between the states that do not create anything. Accepting is
 * its own action, because it makes a signing; and an accepted request is left
 * alone so the link between it and its signing cannot be quietly broken.
 */
export async function setRequestStatusAction(requestId: string, status: string): Promise<void> {
  const user = await requireUser();
  if (!REQUEST_STATUS_CHANGES.has(status)) return;

  await prisma.workRequest.updateMany({
    where: { id: requestId, userId: user.id, status: { not: 'ACCEPTED' } },
    data: { status },
  });
  revalidateRequests();
}

/** Accept a request: put it on the calendar and carry everything across. */
export async function acceptRequestAction(requestId: string): Promise<void> {
  const user = await requireUser();

  const request = await prisma.workRequest.findFirst({
    where: { id: requestId, userId: user.id },
  });
  if (!request) return;
  if (request.status === 'ACCEPTED' && request.signingId) redirect(`/signings/${request.signingId}`);

  const scheduledAt = proposedStart(request, user.timezone, user.requestMinNoticeHours);
  const serviceLabel = REQUEST_SERVICE_LABELS[request.service as RequestService] ?? 'Notarization';

  // One transaction: claim the request, create the signing, link them. The
  // claim is conditional, so two clicks (or two tabs) cannot book it twice.
  const signing = await prisma.$transaction(async (tx) => {
    const claimed = await tx.workRequest.updateMany({
      where: { id: request.id, userId: user.id, status: { not: 'ACCEPTED' } },
      data: { status: 'ACCEPTED' },
    });
    if (claimed.count === 0) return null;

    const created = await tx.signing.create({
      data: {
        userId: user.id,
        title: `${serviceLabel.split(' (')[0]} — ${request.requesterName}`,
        type: REQUEST_SERVICE_TO_SIGNING_TYPE[request.service as RequestService] ?? 'OTHER',
        status: 'SCHEDULED',
        scheduledAt,
        signerName: request.requesterName,
        signerPhone: request.requesterPhone,
        signerEmail: request.requesterEmail,
        addressLine1: request.addressLine1,
        city: request.city,
        state: request.state,
        postalCode: request.postalCode,
        notes: requestNote(request),
      },
    });

    await tx.workRequest.update({ where: { id: request.id }, data: { signingId: created.id } });
    return created;
  });

  if (!signing) {
    // Lost the race: somebody (this notary, in another tab) already accepted it.
    const accepted = await prisma.workRequest.findFirst({
      where: { id: request.id, userId: user.id },
      select: { signingId: true },
    });
    revalidateRequests();
    redirect(accepted?.signingId ? `/signings/${accepted.signingId}` : '/find-work/requests');
  }

  await dispatchEvent(user.id, 'request.accepted', {
    requestId: request.id,
    signingId: signing.id,
    scheduledAt: signing.scheduledAt.toISOString(),
    requesterName: request.requesterName,
    requesterPhone: request.requesterPhone,
    requesterEmail: request.requesterEmail,
    preferredContact: request.preferredContact,
    service: request.service,
    city: request.city,
    state: request.state,
  });

  revalidateRequests();
  revalidatePath('/signings');
  redirect(`/signings/${signing.id}`);
}

/** Requests hold a stranger's contact details; the notary can erase them. */
export async function deleteRequestAction(requestId: string): Promise<void> {
  const user = await requireUser();
  await prisma.workRequest.deleteMany({ where: { id: requestId, userId: user.id } });
  revalidateRequests();
}

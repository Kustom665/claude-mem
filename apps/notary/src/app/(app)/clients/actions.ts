'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { requireUser } from '@/lib/auth';
import { prisma } from '@/lib/db';
import { dispatchEvent } from '@/lib/webhooks';
import {
  clientSchema,
  formDataToObject,
  toFieldErrors,
  type FieldErrors,
} from '@/lib/validation';

export type ClientFormState = { errors: FieldErrors } | null;

export async function createClientAction(
  _prev: ClientFormState,
  formData: FormData,
): Promise<ClientFormState> {
  const user = await requireUser();

  const parsed = clientSchema.safeParse(formDataToObject(formData));
  if (!parsed.success) return { errors: toFieldErrors(parsed.error) };

  const client = await prisma.client.create({
    data: { ...parsed.data, userId: user.id },
  });

  await dispatchEvent(user.id, 'client.created', {
    clientId: client.id,
    name: client.name,
    type: client.type,
    email: client.email,
    phone: client.phone,
    contactName: client.contactName,
  });

  revalidatePath('/clients');
  redirect(`/clients/${client.id}`);
}

export async function updateClientAction(
  clientId: string,
  _prev: ClientFormState,
  formData: FormData,
): Promise<ClientFormState> {
  const user = await requireUser();

  const parsed = clientSchema.safeParse(formDataToObject(formData));
  if (!parsed.success) return { errors: toFieldErrors(parsed.error) };

  // updateMany scoped by userId: a forged id updates zero rows rather than
  // someone else's client.
  const result = await prisma.client.updateMany({
    where: { id: clientId, userId: user.id },
    data: parsed.data,
  });

  if (result.count === 0) {
    return { errors: { _form: 'That client no longer exists.' } };
  }

  revalidatePath('/clients');
  revalidatePath(`/clients/${clientId}`);
  return null;
}

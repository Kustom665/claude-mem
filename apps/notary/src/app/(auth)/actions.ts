'use server';

import { redirect } from 'next/navigation';
import { headers } from 'next/headers';
import { Prisma } from '@/generated/prisma';
import { prisma } from '@/lib/db';
import { createSession, hashPassword, verifyPassword } from '@/lib/auth';
import { onboardingDefaults } from '@/lib/onboarding';
import {
  formDataToObject,
  signInSchema,
  signUpSchema,
  toFieldErrors,
  type FieldErrors,
} from '@/lib/validation';

export type AuthState = { errors: FieldErrors } | null;

export async function signUpAction(_prev: AuthState, formData: FormData): Promise<AuthState> {
  const parsed = signUpSchema.safeParse(formDataToObject(formData));
  if (!parsed.success) {
    return { errors: toFieldErrors(parsed.error) };
  }

  const { name, email, password, commissionState } = parsed.data;

  let userId: string;
  try {
    const user = await prisma.user.create({
      data: {
        name,
        email,
        passwordHash: await hashPassword(password),
        commissionState,
        // 14-day trial. Nothing enforces it yet — the field exists so gating
        // can be switched on without a migration.
        trialEndsOn: new Date(Date.now() + 14 * 24 * 60 * 60 * 1000),
        ...onboardingDefaults(commissionState),
      },
      select: { id: true },
    });
    userId = user.id;
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
      return { errors: { email: 'An account already exists for that email address.' } };
    }
    throw error;
  }

  const userAgent = (await headers()).get('user-agent') ?? undefined;
  await createSession(userId, userAgent);

  redirect('/dashboard');
}

export async function signInAction(_prev: AuthState, formData: FormData): Promise<AuthState> {
  const parsed = signInSchema.safeParse(formDataToObject(formData));
  if (!parsed.success) {
    return { errors: toFieldErrors(parsed.error) };
  }

  const { email, password } = parsed.data;
  const user = await prisma.user.findUnique({ where: { email } });

  // Compare against a dummy hash when the account does not exist, so the
  // response time does not reveal which addresses are registered.
  const hash = user?.passwordHash ?? DUMMY_HASH;
  const valid = await verifyPassword(password, hash);

  if (!user || !valid) {
    return { errors: { _form: 'That email and password combination is not recognised.' } };
  }

  const userAgent = (await headers()).get('user-agent') ?? undefined;
  await createSession(user.id, userAgent);

  redirect('/dashboard');
}

/** bcrypt hash of a value no user can produce, used for timing equalisation. */
const DUMMY_HASH = '$2b$12$C6UzMDM.H6dfI/f/IKcEeO3nGZ0m0Kkm1sEXAMPLEHASHvalue.q';

import type { FieldErrors } from "@/lib/validation";

/** Shared shape for every `useActionState` form in the dashboard. */
export type FormState = {
  ok: boolean | null;
  message?: string;
  errors?: FieldErrors;
};

export const idleFormState: FormState = { ok: null };

export function formError(
  message: string,
  errors?: FieldErrors,
): FormState {
  return { ok: false, message, errors };
}

export function formSuccess(message: string): FormState {
  return { ok: true, message };
}

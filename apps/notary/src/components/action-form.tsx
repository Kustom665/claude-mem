'use client';

import { startTransition, type ComponentProps } from 'react';

/**
 * A form for server actions that keeps what was typed when the action says no.
 *
 * React 19 resets an uncontrolled form as soon as its action finishes — success
 * or failure — back to the default values it was rendered with. For a form whose
 * defaults come from the server that is exactly wrong on a rejection: the notary
 * fills in a long journal entry, one field fails validation, and every other
 * field empties, selects included. A rejected submission is the common case, so
 * the whole form silently ate their work.
 *
 * Calling the action ourselves, inside a transition, from an `onSubmit` that
 * prevents the native submit, skips that automatic reset while React still marks
 * the form pending (so `useFormStatus` in a submit button keeps working) and
 * still runs the action as a transition. The `action` attribute stays, so a
 * browser that submits before the page has hydrated still reaches the server.
 *
 * Forms that should clear after a success (a mileage log, a new fee) do it
 * explicitly with a ref, where it is obvious.
 */
export function ActionForm({
  action,
  onSubmit,
  ...rest
}: Omit<ComponentProps<'form'>, 'action'> & { action: (formData: FormData) => void }) {
  return (
    <form
      action={action}
      onSubmit={(event) => {
        onSubmit?.(event);
        if (event.defaultPrevented) return;

        event.preventDefault();
        // A submit button can carry its own name and value; keep them, as the
        // browser would.
        const submitter = (event.nativeEvent as SubmitEvent).submitter;
        const formData = new FormData(
          event.currentTarget,
          submitter instanceof HTMLElement ? submitter : undefined,
        );
        startTransition(() => action(formData));
      }}
      {...rest}
    />
  );
}

'use client';

import { useFormStatus } from 'react-dom';
import { Button } from '@/components/ui';

/**
 * A submit button that asks first.
 *
 * Deleting a pipeline entry or a stranger's request is not undoable, and both
 * sit one tap from harmless buttons on a phone. The confirmation is the browser's
 * own, so it works without any further client code.
 */
export function ConfirmSubmitButton({
  label,
  pendingLabel,
  confirmMessage,
  variant = 'danger',
  className,
}: {
  label: string;
  pendingLabel: string;
  confirmMessage: string;
  variant?: 'primary' | 'secondary' | 'danger' | 'ghost';
  className?: string;
}) {
  const { pending } = useFormStatus();

  return (
    <Button
      type="submit"
      variant={variant}
      disabled={pending}
      className={className}
      onClick={(event) => {
        if (!window.confirm(confirmMessage)) event.preventDefault();
      }}
    >
      {pending ? pendingLabel : label}
    </Button>
  );
}

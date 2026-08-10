"use client";

import { useFormStatus } from "react-dom";

import { buttonClasses, type ButtonVariant } from "@/components/ui";

export function SubmitButton({
  children,
  pendingLabel,
  variant = "primary",
  className,
  formAction,
  name,
  value,
  confirm,
}: {
  children: React.ReactNode;
  pendingLabel?: string;
  variant?: ButtonVariant;
  className?: string;
  formAction?: (formData: FormData) => void | Promise<void>;
  name?: string;
  value?: string;
  /** When set, the click must be confirmed before the form submits. */
  confirm?: string;
}) {
  const { pending } = useFormStatus();

  return (
    <button
      type="submit"
      name={name}
      value={value}
      formAction={formAction}
      disabled={pending}
      aria-busy={pending}
      onClick={
        confirm
          ? (event) => {
              if (!window.confirm(confirm)) event.preventDefault();
            }
          : undefined
      }
      className={buttonClasses(variant, className)}
    >
      {pending && pendingLabel ? pendingLabel : children}
    </button>
  );
}

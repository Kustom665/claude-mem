import Link from 'next/link';
import type { ComponentProps, ReactNode } from 'react';

/**
 * Presentational primitives.
 *
 * All server components — nothing here needs client JS. Interactive behaviour
 * lives in the handful of components under components/ that opt into 'use
 * client' explicitly.
 */

/**
 * Join class names, dropping anything falsy. Accepts `unknown` so guard
 * expressions like `{cond && 'mt-1'}` type-check when `cond` is a ReactNode.
 */
function cx(...parts: unknown[]): string {
  return parts.filter((part): part is string => typeof part === 'string' && part !== '').join(' ');
}

// ---------------------------------------------------------------------------
// Layout
// ---------------------------------------------------------------------------

export function PageHeader({
  title,
  description,
  actions,
}: {
  title: string;
  description?: ReactNode;
  actions?: ReactNode;
}) {
  return (
    <header className="mb-6 flex flex-wrap items-start justify-between gap-4">
      <div className="min-w-0">
        <h1 className="text-2xl font-semibold tracking-tight text-[var(--text)]">{title}</h1>
        {description ? (
          <p className="mt-1 max-w-2xl text-sm text-[var(--text-muted)]">{description}</p>
        ) : null}
      </div>
      {actions ? <div className="flex shrink-0 flex-wrap gap-2">{actions}</div> : null}
    </header>
  );
}

export function Card({
  children,
  className,
  ...rest
}: ComponentProps<'section'>) {
  return (
    <section
      className={cx(
        'rounded-xl border border-[var(--border)] bg-[var(--surface-raised)] shadow-sm',
        className,
      )}
      {...rest}
    >
      {children}
    </section>
  );
}

export function CardHeader({
  title,
  description,
  actions,
}: {
  title: ReactNode;
  description?: ReactNode;
  actions?: ReactNode;
}) {
  return (
    <div className="flex flex-wrap items-start justify-between gap-3 border-b border-[var(--border)] px-5 py-4">
      <div className="min-w-0">
        <h2 className="text-sm font-semibold text-[var(--text)]">{title}</h2>
        {description ? (
          <p className="mt-0.5 text-sm text-[var(--text-muted)]">{description}</p>
        ) : null}
      </div>
      {actions ? <div className="flex shrink-0 gap-2">{actions}</div> : null}
    </div>
  );
}

export function CardBody({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={cx('px-5 py-4', className)}>{children}</div>;
}

// ---------------------------------------------------------------------------
// Buttons
// ---------------------------------------------------------------------------

type ButtonVariant = 'primary' | 'secondary' | 'danger' | 'ghost';

const BUTTON_BASE =
  'focus-ring inline-flex items-center justify-center gap-2 rounded-lg px-3.5 py-2 text-sm font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-60';

const BUTTON_VARIANTS: Record<ButtonVariant, string> = {
  primary: 'bg-seal-600 text-white hover:bg-seal-700',
  secondary:
    'border border-[var(--border-strong)] bg-[var(--surface)] text-[var(--text)] hover:bg-[var(--surface-sunken)]',
  danger: 'border border-red-300 bg-red-50 text-red-800 hover:bg-red-100',
  ghost: 'text-[var(--text-muted)] hover:bg-[var(--surface-sunken)] hover:text-[var(--text)]',
};

export function Button({
  variant = 'primary',
  className,
  ...rest
}: ComponentProps<'button'> & { variant?: ButtonVariant }) {
  return <button className={cx(BUTTON_BASE, BUTTON_VARIANTS[variant], className)} {...rest} />;
}

export function LinkButton({
  variant = 'secondary',
  className,
  href,
  ...rest
}: ComponentProps<typeof Link> & { variant?: ButtonVariant }) {
  return (
    <Link href={href} className={cx(BUTTON_BASE, BUTTON_VARIANTS[variant], className)} {...rest} />
  );
}

// ---------------------------------------------------------------------------
// Forms
// ---------------------------------------------------------------------------

const CONTROL =
  'focus-ring w-full rounded-lg border border-[var(--border-strong)] bg-[var(--surface)] px-3 py-2 text-sm text-[var(--text)] placeholder:text-[var(--text-subtle)] disabled:opacity-60';

export function Field({
  label,
  htmlFor,
  error,
  hint,
  required,
  children,
  className,
}: {
  label: string;
  htmlFor?: string;
  error?: string;
  hint?: ReactNode;
  required?: boolean;
  children: ReactNode;
  className?: string;
}) {
  return (
    <div className={cx('min-w-0', className)}>
      <label
        htmlFor={htmlFor}
        className="mb-1.5 block text-xs font-medium text-[var(--text-muted)]"
      >
        {label}
        {required ? <span className="ml-0.5 text-red-500">*</span> : null}
      </label>
      {children}
      {error ? (
        <p className="mt-1 text-xs font-medium text-red-600">{error}</p>
      ) : hint ? (
        <p className="mt-1 text-xs text-[var(--text-subtle)]">{hint}</p>
      ) : null}
    </div>
  );
}

export function Input({ className, ...rest }: ComponentProps<'input'>) {
  return <input className={cx(CONTROL, className)} {...rest} />;
}

export function Textarea({ className, ...rest }: ComponentProps<'textarea'>) {
  return <textarea className={cx(CONTROL, 'min-h-20 resize-y', className)} {...rest} />;
}

export function Select({ className, children, ...rest }: ComponentProps<'select'>) {
  return (
    <select className={cx(CONTROL, 'pr-8', className)} {...rest}>
      {children}
    </select>
  );
}

export function Checkbox({
  label,
  hint,
  className,
  ...rest
}: ComponentProps<'input'> & { label: string; hint?: ReactNode }) {
  return (
    <label className={cx('flex cursor-pointer items-start gap-2.5', className)}>
      <input
        type="checkbox"
        className="focus-ring mt-0.5 h-4 w-4 shrink-0 rounded border-[var(--border-strong)] accent-seal-600"
        {...rest}
      />
      <span className="min-w-0">
        <span className="block text-sm text-[var(--text)]">{label}</span>
        {hint ? <span className="block text-xs text-[var(--text-subtle)]">{hint}</span> : null}
      </span>
    </label>
  );
}

export function FormError({ message }: { message?: string }) {
  if (!message) return null;
  return (
    <div
      role="alert"
      className="rounded-lg border border-red-300 bg-red-50 px-3.5 py-2.5 text-sm text-red-800"
    >
      {message}
    </div>
  );
}

export function Fieldset({
  legend,
  description,
  children,
  className,
}: {
  legend: string;
  description?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <fieldset className={cx('min-w-0', className)}>
      <legend className="text-sm font-semibold text-[var(--text)]">{legend}</legend>
      {description ? (
        <p className="mt-0.5 mb-3 text-xs text-[var(--text-muted)]">{description}</p>
      ) : (
        <div className="mb-3" />
      )}
      {children}
    </fieldset>
  );
}

// ---------------------------------------------------------------------------
// Status
// ---------------------------------------------------------------------------

export type Tone = 'neutral' | 'info' | 'success' | 'warning' | 'danger';

const TONE_BADGE: Record<Tone, string> = {
  neutral: 'bg-[var(--surface-sunken)] text-[var(--text-muted)] border-[var(--border)]',
  info: 'bg-seal-50 text-seal-800 border-seal-200',
  success: 'bg-emerald-50 text-emerald-800 border-emerald-200',
  warning: 'bg-amber-50 text-amber-900 border-amber-200',
  danger: 'bg-red-50 text-red-800 border-red-200',
};

export function Badge({
  tone = 'neutral',
  children,
  className,
}: {
  tone?: Tone;
  children: ReactNode;
  className?: string;
}) {
  return (
    <span
      className={cx(
        'inline-flex items-center gap-1 rounded-md border px-2 py-0.5 text-xs font-medium whitespace-nowrap',
        TONE_BADGE[tone],
        className,
      )}
    >
      {children}
    </span>
  );
}

const TONE_ALERT: Record<Tone, string> = {
  neutral: 'border-[var(--border)] bg-[var(--surface-sunken)] text-[var(--text-muted)]',
  info: 'border-seal-200 bg-seal-50 text-seal-900',
  success: 'border-emerald-200 bg-emerald-50 text-emerald-900',
  warning: 'border-amber-200 bg-amber-50 text-amber-900',
  danger: 'border-red-200 bg-red-50 text-red-900',
};

export function Alert({
  tone = 'info',
  title,
  children,
  actions,
  className,
}: {
  tone?: Tone;
  title?: ReactNode;
  children?: ReactNode;
  actions?: ReactNode;
  className?: string;
}) {
  return (
    <div className={cx('rounded-lg border px-4 py-3 text-sm', TONE_ALERT[tone], className)}>
      {title ? <p className="font-semibold">{title}</p> : null}
      {children ? <div className={cx(title && 'mt-1', 'leading-relaxed')}>{children}</div> : null}
      {actions ? <div className="mt-2.5 flex flex-wrap gap-2">{actions}</div> : null}
    </div>
  );
}

export function StatTile({
  label,
  value,
  sublabel,
  tone = 'neutral',
}: {
  label: string;
  value: ReactNode;
  sublabel?: ReactNode;
  tone?: Tone;
}) {
  const valueTone: Record<Tone, string> = {
    neutral: 'text-[var(--text)]',
    info: 'text-seal-700',
    success: 'text-emerald-700',
    warning: 'text-amber-700',
    danger: 'text-red-700',
  };

  return (
    <div className="rounded-xl border border-[var(--border)] bg-[var(--surface-raised)] px-4 py-3.5">
      <p className="text-xs font-medium tracking-wide text-[var(--text-muted)] uppercase">
        {label}
      </p>
      <p className={cx('tabular mt-1.5 text-2xl font-semibold', valueTone[tone])}>{value}</p>
      {sublabel ? <p className="mt-0.5 text-xs text-[var(--text-subtle)]">{sublabel}</p> : null}
    </div>
  );
}

export function EmptyState({
  title,
  description,
  action,
}: {
  title: string;
  description?: ReactNode;
  action?: ReactNode;
}) {
  return (
    <div className="px-5 py-12 text-center">
      <p className="text-sm font-medium text-[var(--text)]">{title}</p>
      {description ? (
        <p className="mx-auto mt-1 max-w-md text-sm text-[var(--text-muted)]">{description}</p>
      ) : null}
      {action ? <div className="mt-4 flex justify-center">{action}</div> : null}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Tables
// ---------------------------------------------------------------------------

export function Table({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <div className="overflow-x-auto">
      <table className={cx('w-full min-w-full border-collapse text-sm', className)}>
        {children}
      </table>
    </div>
  );
}

export function Th({
  children,
  align = 'left',
  className,
}: {
  children?: ReactNode;
  align?: 'left' | 'right' | 'center';
  className?: string;
}) {
  return (
    <th
      scope="col"
      className={cx(
        'border-b border-[var(--border)] px-4 py-2.5 text-xs font-semibold tracking-wide text-[var(--text-muted)] uppercase whitespace-nowrap',
        align === 'right' && 'text-right',
        align === 'center' && 'text-center',
        align === 'left' && 'text-left',
        className,
      )}
    >
      {children}
    </th>
  );
}

export function Td({
  children,
  align = 'left',
  className,
  colSpan,
}: {
  children?: ReactNode;
  align?: 'left' | 'right' | 'center';
  className?: string;
  colSpan?: number;
}) {
  return (
    <td
      colSpan={colSpan}
      className={cx(
        'border-b border-[var(--border)] px-4 py-3 align-top text-[var(--text)]',
        align === 'right' && 'text-right',
        align === 'center' && 'text-center',
        className,
      )}
    >
      {children}
    </td>
  );
}

export function DescriptionList({ children }: { children: ReactNode }) {
  return <dl className="grid gap-x-6 gap-y-3 sm:grid-cols-2">{children}</dl>;
}

export function DescriptionItem({
  term,
  children,
  wide,
}: {
  term: string;
  children: ReactNode;
  wide?: boolean;
}) {
  return (
    <div className={cx('min-w-0', wide && 'sm:col-span-2')}>
      <dt className="text-xs font-medium tracking-wide text-[var(--text-muted)] uppercase">
        {term}
      </dt>
      <dd className="mt-0.5 text-sm break-words text-[var(--text)]">{children}</dd>
    </div>
  );
}

export { cx };

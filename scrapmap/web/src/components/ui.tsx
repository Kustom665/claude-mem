import type { ReactNode } from 'react';
import { CATEGORY_STYLES, STATUS_STYLES } from '../lib/format.ts';

export function Spinner({ label = 'Loading' }: { label?: string }) {
  return (
    <div className="flex items-center justify-center gap-3 py-10 text-sm text-zinc-500">
      <span
        className="h-4 w-4 animate-spin rounded-full border-2 border-zinc-700 border-t-copper-400"
        aria-hidden
      />
      {label}…
    </div>
  );
}

export function EmptyState({
  title,
  body,
  action,
}: {
  title: string;
  body: string;
  action?: ReactNode;
}) {
  return (
    <div className="card flex flex-col items-center gap-3 px-6 py-12 text-center">
      <p className="text-base font-semibold text-zinc-200">{title}</p>
      <p className="max-w-md text-sm text-zinc-500">{body}</p>
      {action}
    </div>
  );
}

export function ErrorNote({ message }: { message: string }) {
  return (
    <div
      role="alert"
      className="rounded-lg border border-red-900/60 bg-red-950/40 px-3 py-2.5 text-sm text-red-300"
    >
      {message}
    </div>
  );
}

export function StatusBadge({ status }: { status: string }) {
  return (
    <span className={`chip ${STATUS_STYLES[status] ?? STATUS_STYLES.completed}`}>{status}</span>
  );
}

export function CategoryBadge({ category, label }: { category: string; label?: string }) {
  return (
    <span className={`chip ${CATEGORY_STYLES[category] ?? CATEGORY_STYLES.other}`}>
      {label ?? category}
    </span>
  );
}

export function Stars({ rating, count }: { rating: number | null; count?: number }) {
  if (rating === null) {
    return <span className="text-xs text-zinc-600">No ratings yet</span>;
  }
  const rounded = Math.round(rating);
  return (
    <span
      className="inline-flex items-center gap-1 text-xs text-amber-400"
      title={`${rating.toFixed(1)} out of 5`}
    >
      <span aria-hidden>{'★'.repeat(rounded)}{'☆'.repeat(5 - rounded)}</span>
      <span className="text-zinc-500">
        {rating.toFixed(1)}
        {count === undefined ? '' : ` (${count})`}
      </span>
    </span>
  );
}

/**
 * Every dollar figure in ScrapMap is an estimate off a commodity index, not a
 * quote. Saying so once next to the number is more honest than a footnote.
 */
export function EstimateNote({ className = '' }: { className?: string }) {
  return (
    <p className={`text-[11px] leading-relaxed text-zinc-600 ${className}`}>
      Estimated yard payout, based on the current copper index and typical grade percentages.
      Real prices vary by yard, region, and volume — call ahead.
    </p>
  );
}

export function Field({
  label,
  hint,
  error,
  children,
  required,
}: {
  label: string;
  hint?: string;
  error?: string[];
  children: ReactNode;
  required?: boolean;
}) {
  return (
    <label className="block">
      <span className="field-label">
        {label}
        {required ? <span className="ml-1 text-copper-400">*</span> : null}
      </span>
      {children}
      {hint ? <span className="mt-1 block text-xs text-zinc-500">{hint}</span> : null}
      {error?.length ? (
        <span className="mt-1 block text-xs text-red-400">{error.join(' ')}</span>
      ) : null}
    </label>
  );
}

export function Toggle({
  checked,
  onChange,
  label,
  description,
}: {
  checked: boolean;
  onChange: (next: boolean) => void;
  label: string;
  description?: string;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      onClick={() => onChange(!checked)}
      className={`flex w-full items-start gap-3 rounded-lg border px-3 py-3 text-left transition-colors ${
        checked
          ? 'border-copper-600 bg-copper-950/40'
          : 'border-zinc-700 bg-ink-850 hover:border-zinc-600'
      }`}
    >
      <span
        className={`mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded border text-xs ${
          checked ? 'border-copper-500 bg-copper-500 text-white' : 'border-zinc-600 text-transparent'
        }`}
        aria-hidden
      >
        ✓
      </span>
      <span>
        <span className="block text-sm font-medium text-zinc-200">{label}</span>
        {description ? (
          <span className="mt-0.5 block text-xs text-zinc-500">{description}</span>
        ) : null}
      </span>
    </button>
  );
}

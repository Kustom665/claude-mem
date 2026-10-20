export const money = (cents: number): string =>
  (cents / 100).toLocaleString(undefined, {
    style: 'currency',
    currency: 'USD',
    maximumFractionDigits: cents % 100 === 0 ? 0 : 2,
  });

export const perPound = (usd: number): string => `$${usd.toFixed(2)}/lb`;

export const weight = (lbs: number): string =>
  lbs >= 2000 ? `${(lbs / 2000).toFixed(1)} tons` : `${Math.round(lbs).toLocaleString()} lbs`;

export const miles = (value: number | null): string =>
  value === null ? '' : value < 0.1 ? 'right here' : `${value.toFixed(1)} mi`;

/** Compact relative time: "3h ago", "2d ago". */
export function timeAgo(iso: string): string {
  const seconds = Math.floor((Date.now() - new Date(iso).getTime()) / 1000);
  if (seconds < 60) return 'just now';
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `${days}d ago`;
  const months = Math.floor(days / 30);
  if (months < 12) return `${months}mo ago`;
  return `${Math.floor(months / 12)}y ago`;
}

export const dateTime = (iso: string): string =>
  new Date(iso).toLocaleString(undefined, {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });

export const dateOnly = (iso: string): string =>
  new Date(iso).toLocaleDateString(undefined, {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
  });

export function priceLabel(priceType: string, priceCents: number): string {
  if (priceType === 'free') return 'Free';
  if (priceType === 'obo') return `${money(priceCents)} obo`;
  return money(priceCents);
}

export const STATUS_STYLES: Record<string, string> = {
  open: 'bg-emerald-950 text-emerald-300 ring-1 ring-emerald-800/60',
  claimed: 'bg-amber-950 text-amber-300 ring-1 ring-amber-800/60',
  completed: 'bg-zinc-800 text-zinc-400 ring-1 ring-zinc-700',
  cancelled: 'bg-zinc-800 text-zinc-500 ring-1 ring-zinc-700',
  expired: 'bg-zinc-800 text-zinc-500 ring-1 ring-zinc-700',
};

export const CATEGORY_STYLES: Record<string, string> = {
  copper: 'bg-copper-900/60 text-copper-200 ring-1 ring-copper-700/60',
  'insulated-wire': 'bg-orange-950 text-orange-300 ring-1 ring-orange-900',
  'copper-bearing': 'bg-rose-950 text-rose-300 ring-1 ring-rose-900',
  brass: 'bg-yellow-950 text-yellow-300 ring-1 ring-yellow-900',
  aluminum: 'bg-sky-950 text-sky-300 ring-1 ring-sky-900',
  steel: 'bg-zinc-800 text-zinc-300 ring-1 ring-zinc-700',
  other: 'bg-violet-950 text-violet-300 ring-1 ring-violet-900',
};

import { Link } from 'react-router-dom';
import type { Listing } from '../api/types.ts';
import { miles, money, priceLabel, timeAgo, weight } from '../lib/format.ts';
import { CategoryBadge, StatusBadge } from './ui.tsx';

export function ListingCard({
  listing,
  onHover,
  highlighted = false,
}: {
  listing: Listing;
  onHover?: (id: string | null) => void;
  highlighted?: boolean;
}) {
  // Show one badge per distinct category rather than one per material line.
  const categories = [...new Set(listing.materials.map((material) => material.category))];
  const cover = listing.photos[0];

  return (
    <Link
      to={`/listing/${listing.id}`}
      onMouseEnter={() => onHover?.(listing.id)}
      onMouseLeave={() => onHover?.(null)}
      className={`card block overflow-hidden transition-colors hover:border-copper-700 ${
        highlighted ? 'border-copper-600 ring-1 ring-copper-700/50' : ''
      }`}
    >
      <div className="flex gap-3 p-3">
        {cover ? (
          <img
            src={cover.url}
            alt=""
            loading="lazy"
            className="h-20 w-20 shrink-0 rounded-lg object-cover"
          />
        ) : (
          <div
            className="flex h-20 w-20 shrink-0 items-center justify-center rounded-lg bg-ink-850 text-2xl text-zinc-700"
            aria-hidden
          >
            ⚙
          </div>
        )}

        <div className="min-w-0 flex-1">
          <div className="flex items-start justify-between gap-2">
            <h3 className="truncate text-sm font-semibold text-zinc-100">{listing.title}</h3>
            <span className="shrink-0 text-sm font-bold text-copper-300">
              {priceLabel(listing.priceType, listing.priceCents)}
            </span>
          </div>

          <p className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs text-zinc-500">
            <span>{weight(listing.totalWeightLbs)}</span>
            <span aria-hidden>·</span>
            <span className="text-zinc-400">est. {money(listing.estimatedValueCents)}</span>
            {listing.distanceMiles !== null ? (
              <>
                <span aria-hidden>·</span>
                <span>{miles(listing.distanceMiles)}</span>
              </>
            ) : null}
            {listing.city ? (
              <>
                <span aria-hidden>·</span>
                <span className="truncate">{listing.city}</span>
              </>
            ) : null}
          </p>

          <div className="mt-2 flex flex-wrap items-center gap-1.5">
            {listing.status !== 'open' ? <StatusBadge status={listing.status} /> : null}
            {listing.curbside ? (
              <span className="chip bg-emerald-950 text-emerald-300 ring-1 ring-emerald-800/60">
                curbside
              </span>
            ) : null}
            {listing.helpNeeded ? (
              <span className="chip bg-amber-950 text-amber-300 ring-1 ring-amber-900">
                needs muscle
              </span>
            ) : null}
            {categories.slice(0, 3).map((category) => (
              <CategoryBadge key={category} category={category} />
            ))}
          </div>
        </div>
      </div>

      <div className="flex items-center justify-between border-t border-zinc-800/80 px-3 py-1.5 text-[11px] text-zinc-600">
        <span>{listing.ownerName ?? 'A neighbor'}</span>
        <span>{timeAgo(listing.createdAt)}</span>
      </div>
    </Link>
  );
}

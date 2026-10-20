import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { api, type BrowseParams } from '../api/client.ts';
import type { Listing, MaterialsResponse } from '../api/types.ts';
import { useAuth } from '../state/auth.tsx';
import { MapView } from '../components/MapView.tsx';
import { ListingCard } from '../components/ListingCard.tsx';
import { AddressSearch } from '../components/AddressSearch.tsx';
import { EmptyState, ErrorNote, Spinner } from '../components/ui.tsx';
import { money, weight } from '../lib/format.ts';

/** Columbus, Ohio — where the demo data lives. */
const FALLBACK_CENTER: [number, number] = [39.9612, -82.9988];

const RADIUS_OPTIONS = [5, 10, 25, 50, 100];
const SORT_OPTIONS: { value: NonNullable<BrowseParams['sort']>; label: string }[] = [
  { value: 'closest', label: 'Closest' },
  { value: 'newest', label: 'Newest' },
  { value: 'value', label: 'Highest value' },
  { value: 'weight', label: 'Heaviest' },
];

export function Browse() {
  const { user } = useAuth();
  const [searchParams, setSearchParams] = useSearchParams();

  const [center, setCenter] = useState<[number, number]>(FALLBACK_CENTER);
  const [locationLabel, setLocationLabel] = useState('Columbus, Ohio');
  const [listings, setListings] = useState<Listing[]>([]);
  const [catalog, setCatalog] = useState<MaterialsResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [hovered, setHovered] = useState<string | null>(null);
  const [showMapOnMobile, setShowMapOnMobile] = useState(false);

  const radiusMiles = Number(searchParams.get('radius') ?? '25');
  const sort = (searchParams.get('sort') ?? 'closest') as NonNullable<BrowseParams['sort']>;
  const category = searchParams.get('category') ?? '';
  const search = searchParams.get('q') ?? '';
  const curbsideOnly = searchParams.get('curbside') === '1';
  const freeOnly = searchParams.get('free') === '1';

  // A signed-in member's saved home base beats the demo fallback.
  useEffect(() => {
    if (user?.homeLat != null && user.homeLon != null) {
      setCenter([user.homeLat, user.homeLon]);
      setLocationLabel(user.city ? `${user.city}${user.region ? `, ${user.region}` : ''}` : 'Your area');
    }
  }, [user]);

  useEffect(() => {
    api.materials().then(setCatalog).catch(() => setCatalog(null));
  }, []);

  const updateParam = useCallback(
    (key: string, value: string | null) => {
      const next = new URLSearchParams(searchParams);
      if (value === null || value === '') next.delete(key);
      else next.set(key, value);
      setSearchParams(next, { replace: true });
    },
    [searchParams, setSearchParams],
  );

  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    setError(null);

    api
      .browse(
        {
          lat: center[0],
          lon: center[1],
          radiusMiles,
          sort,
          status: 'open',
          category: category || undefined,
          search: search || undefined,
          curbside: curbsideOnly ? true : undefined,
          priceType: freeOnly ? 'free' : undefined,
          limit: 60,
        },
        controller.signal,
      )
      .then((data) => setListings(data.listings))
      .catch((caught: Error) => {
        if (caught.name !== 'AbortError') setError(caught.message);
      })
      .finally(() => setLoading(false));

    return () => controller.abort();
  }, [center, radiusMiles, sort, category, search, curbsideOnly, freeOnly]);

  // Free-text search waits for a pause in typing before touching the URL.
  const searchTimer = useRef<number | undefined>(undefined);
  const debouncedSearch = useCallback(
    (value: string) => {
      window.clearTimeout(searchTimer.current);
      searchTimer.current = window.setTimeout(() => updateParam('q', value), 400);
    },
    [updateParam],
  );
  useEffect(() => () => window.clearTimeout(searchTimer.current), []);

  const totals = useMemo(
    () => ({
      pounds: listings.reduce((sum, listing) => sum + listing.totalWeightLbs, 0),
      value: listings.reduce((sum, listing) => sum + listing.estimatedValueCents, 0),
    }),
    [listings],
  );

  return (
    <div className="mx-auto max-w-7xl px-4 py-4">
      <div className="mb-4 flex flex-col gap-3">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <h1 className="text-xl font-bold text-zinc-100">Scrap near {locationLabel}</h1>
            <p className="mt-0.5 text-sm text-zinc-500">
              {loading
                ? 'Looking…'
                : `${listings.length} open ${listings.length === 1 ? 'pile' : 'piles'} · ${weight(
                    totals.pounds,
                  )} · about ${money(totals.value)} of metal`}
            </p>
          </div>

          <button
            type="button"
            className="btn-secondary lg:hidden"
            onClick={() => setShowMapOnMobile((value) => !value)}
          >
            {showMapOnMobile ? 'Show list' : 'Show map'}
          </button>
        </div>

        <div className="card grid gap-3 p-3 sm:grid-cols-2 lg:grid-cols-4">
          <div className="sm:col-span-2 lg:col-span-1">
            <AddressSearch
              placeholder="Search another area"
              onSelect={(result) => {
                setCenter([result.lat, result.lon]);
                setLocationLabel(result.city ?? result.displayName.split(',')[0] ?? 'that area');
              }}
            />
          </div>

          <input
            className="field"
            placeholder="Search titles, e.g. romex"
            defaultValue={search}
            onChange={(event) => debouncedSearch(event.target.value)}
          />

          <select
            className="field"
            value={category}
            onChange={(event) => updateParam('category', event.target.value)}
          >
            <option value="">All materials</option>
            {catalog?.categories.map((item) => (
              <option key={item.key} value={item.key}>
                {item.label}
              </option>
            ))}
          </select>

          <div className="flex gap-2">
            <select
              className="field"
              value={radiusMiles}
              onChange={(event) => updateParam('radius', event.target.value)}
              aria-label="Search radius"
            >
              {RADIUS_OPTIONS.map((value) => (
                <option key={value} value={value}>
                  {value} mi
                </option>
              ))}
            </select>
            <select
              className="field"
              value={sort}
              onChange={(event) => updateParam('sort', event.target.value)}
              aria-label="Sort order"
            >
              {SORT_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </div>

          <div className="flex flex-wrap gap-2 sm:col-span-2 lg:col-span-4">
            <FilterChip
              active={curbsideOnly}
              onClick={() => updateParam('curbside', curbsideOnly ? null : '1')}
            >
              Curbside — no contact needed
            </FilterChip>
            <FilterChip active={freeOnly} onClick={() => updateParam('free', freeOnly ? null : '1')}>
              Free only
            </FilterChip>
            {(category || search || curbsideOnly || freeOnly) && (
              <button
                type="button"
                className="chip text-zinc-500 hover:text-zinc-300"
                onClick={() => setSearchParams({}, { replace: true })}
              >
                Clear filters
              </button>
            )}
          </div>
        </div>
      </div>

      <div className="grid gap-4 lg:grid-cols-[minmax(0,26rem)_1fr]">
        <div className={`space-y-3 ${showMapOnMobile ? 'hidden lg:block' : ''}`}>
          {error ? <ErrorNote message={error} /> : null}
          {loading ? <Spinner label="Finding scrap" /> : null}

          {!loading && listings.length === 0 ? (
            <EmptyState
              title="Nothing posted here yet"
              body="Try widening the radius, clearing filters, or searching a different town. If you have metal sitting around yourself, posting it is what gets a neighborhood started."
              action={
                <Link to="/post" className="btn-primary mt-1">
                  Post the first pile
                </Link>
              }
            />
          ) : null}

          {listings.map((listing) => (
            <ListingCard
              key={listing.id}
              listing={listing}
              onHover={setHovered}
              highlighted={hovered === listing.id}
            />
          ))}
        </div>

        <div
          className={`overflow-hidden rounded-xl border border-zinc-800 ${
            showMapOnMobile ? '' : 'hidden lg:block'
          }`}
          style={{ height: 'min(78vh, 46rem)' }}
        >
          <MapView
            center={center}
            zoom={radiusMiles <= 5 ? 13 : radiusMiles <= 25 ? 11 : 9}
            listings={listings}
            radiusMiles={radiusMiles}
            homeMarker={
              user?.homeLat != null && user.homeLon != null ? [user.homeLat, user.homeLon] : null
            }
            onListingHover={setHovered}
            highlightId={hovered}
          />
        </div>
      </div>
    </div>
  );
}

function FilterChip({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={`chip border transition-colors ${
        active
          ? 'border-copper-600 bg-copper-950/60 text-copper-200'
          : 'border-zinc-700 text-zinc-400 hover:border-zinc-600 hover:text-zinc-200'
      }`}
    >
      {children}
    </button>
  );
}

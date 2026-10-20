import { useCallback, useEffect, useState } from 'react';
import { api, ApiError } from '../api/client.ts';
import type { ScrapYard } from '../api/types.ts';
import { useAuth } from '../state/auth.tsx';
import { MapView } from '../components/MapView.tsx';
import { AddressSearch } from '../components/AddressSearch.tsx';
import { EmptyState, ErrorNote, Spinner } from '../components/ui.tsx';

const KIND_LABELS: Record<ScrapYard['kind'], string> = {
  'scrap-yard': 'Scrap yard',
  'metal-recycling': 'Takes scrap metal',
  'recycling-centre': 'Recycling centre',
};

/** Where to sell it — half of "find scrap copper" is knowing who buys. */
export function Yards() {
  const { user } = useAuth();
  const [center, setCenter] = useState<[number, number]>([39.9612, -82.9988]);
  const [radius, setRadius] = useState(25);
  const [yards, setYards] = useState<ScrapYard[]>([]);
  const [note, setNote] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (user?.homeLat != null && user.homeLon != null) setCenter([user.homeLat, user.homeLon]);
  }, [user]);

  const search = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await api.yards(center[0], center[1], radius);
      setYards(data.yards);
      setNote(data.note);
    } catch (caught) {
      setError(
        caught instanceof ApiError && caught.status === 503
          ? 'The OpenStreetMap lookup service is busy right now. Give it a minute and try again.'
          : 'Could not load nearby yards.',
      );
      setYards([]);
    } finally {
      setLoading(false);
    }
  }, [center, radius]);

  useEffect(() => {
    void search();
  }, [search]);

  return (
    <div className="mx-auto max-w-6xl px-4 py-6">
      <h1 className="text-2xl font-bold text-zinc-100">Scrap yards near you</h1>
      <p className="mt-1 text-sm text-zinc-500">
        Yards and metal recyclers from OpenStreetMap. Call before you load up — hours and what they
        buy from the public vary a lot.
      </p>

      <div className="card mt-4 flex flex-wrap items-end gap-3 p-3">
        <div className="min-w-64 flex-1">
          <AddressSearch
            placeholder="Search from an address or ZIP"
            onSelect={(result) => setCenter([result.lat, result.lon])}
          />
        </div>
        <select
          className="field w-32"
          value={radius}
          onChange={(event) => setRadius(Number(event.target.value))}
          aria-label="Search radius"
        >
          {[10, 25, 50, 100].map((value) => (
            <option key={value} value={value}>
              {value} mi
            </option>
          ))}
        </select>
      </div>

      {error ? <div className="mt-4"><ErrorNote message={error} /></div> : null}

      <div className="mt-4 grid gap-4 lg:grid-cols-[minmax(0,24rem)_1fr]">
        <div className="space-y-2">
          {loading ? <Spinner label="Searching yards" /> : null}

          {!loading && yards.length === 0 && !error ? (
            <EmptyState
              title="No yards mapped here"
              body="OpenStreetMap data is community-maintained, so rural areas are often thin. Try a wider radius, or search near the nearest city."
            />
          ) : null}

          {yards.map((yard) => (
            <div key={yard.id} className="card p-3">
              <div className="flex items-start justify-between gap-2">
                <h2 className="text-sm font-semibold text-zinc-100">{yard.name}</h2>
                <span className="shrink-0 text-xs text-zinc-500">
                  {yard.distanceMiles.toFixed(1)} mi
                </span>
              </div>
              <p className="mt-0.5 text-xs text-sky-400">{KIND_LABELS[yard.kind]}</p>
              {yard.address ? (
                <p className="mt-1 text-xs text-zinc-500">{yard.address}</p>
              ) : null}
              {yard.openingHours ? (
                <p className="mt-1 text-xs text-zinc-500">🕑 {yard.openingHours}</p>
              ) : null}
              <div className="mt-2 flex flex-wrap gap-3 text-xs">
                {yard.phone ? (
                  <a className="text-copper-300 hover:underline" href={`tel:${yard.phone}`}>
                    {yard.phone}
                  </a>
                ) : null}
                {yard.website ? (
                  <a
                    className="text-copper-300 hover:underline"
                    href={yard.website}
                    target="_blank"
                    rel="noreferrer noopener"
                  >
                    Website
                  </a>
                ) : null}
                <a
                  className="text-zinc-500 hover:underline"
                  href={`https://www.openstreetmap.org/directions?to=${yard.lat},${yard.lon}`}
                  target="_blank"
                  rel="noreferrer noopener"
                >
                  Directions
                </a>
              </div>
            </div>
          ))}

          {note ? <p className="px-1 pt-2 text-[11px] text-zinc-600">{note}</p> : null}
        </div>

        <div
          className="overflow-hidden rounded-xl border border-zinc-800"
          style={{ height: 'min(75vh, 42rem)' }}
        >
          <MapView
            center={center}
            zoom={radius <= 10 ? 12 : radius <= 25 ? 11 : 9}
            yards={yards}
            radiusMiles={radius}
          />
        </div>
      </div>
    </div>
  );
}

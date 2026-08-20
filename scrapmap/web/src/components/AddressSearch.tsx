import { useEffect, useRef, useState } from 'react';
import { api } from '../api/client.ts';
import type { GeocodeResult } from '../api/types.ts';

/**
 * Address lookup backed by OpenStreetMap Nominatim through our own API.
 *
 * Nominatim allows one request per second per client, so this debounces hard
 * and only fires once typing pauses — searching on every keystroke would get
 * the service to rate-limit us, and it is a free public resource.
 */
export function AddressSearch({
  onSelect,
  placeholder = 'Street address, city, or ZIP',
  initialValue = '',
  autoFocus = false,
}: {
  onSelect: (result: GeocodeResult) => void;
  placeholder?: string;
  initialValue?: string;
  autoFocus?: boolean;
}) {
  const [text, setText] = useState(initialValue);
  const [results, setResults] = useState<GeocodeResult[]>([]);
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [locating, setLocating] = useState(false);
  const controller = useRef<AbortController | null>(null);
  const boxRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (text.trim().length < 3) {
      setResults([]);
      setError(null);
      return;
    }

    const timer = setTimeout(async () => {
      controller.current?.abort();
      const next = new AbortController();
      controller.current = next;
      setBusy(true);
      setError(null);
      try {
        const { results: found } = await api.geoSearch(text.trim(), next.signal);
        setResults(found);
        setOpen(true);
      } catch (caught) {
        if ((caught as Error).name !== 'AbortError') {
          setError('Address lookup is unavailable right now — you can drop a pin on the map instead.');
          setResults([]);
        }
      } finally {
        setBusy(false);
      }
    }, 600);

    return () => clearTimeout(timer);
  }, [text]);

  // Close the dropdown on an outside click.
  useEffect(() => {
    function onDocumentClick(event: MouseEvent) {
      if (boxRef.current && !boxRef.current.contains(event.target as Node)) setOpen(false);
    }
    document.addEventListener('mousedown', onDocumentClick);
    return () => document.removeEventListener('mousedown', onDocumentClick);
  }, []);

  function useMyLocation() {
    if (!navigator.geolocation) {
      setError('This browser cannot share your location.');
      return;
    }
    setLocating(true);
    navigator.geolocation.getCurrentPosition(
      async (position) => {
        try {
          const { result } = await api.geoReverse(
            position.coords.latitude,
            position.coords.longitude,
          );
          if (result) {
            setText(result.displayName);
            onSelect(result);
          } else {
            // Reverse geocoding failed but the coordinates are still good.
            onSelect({
              displayName: 'Current location',
              lat: position.coords.latitude,
              lon: position.coords.longitude,
              addressLine: null,
              city: null,
              region: null,
              postalCode: null,
              country: null,
              rank: 0,
            });
          }
        } catch {
          setError('Could not look up that location. Try typing an address.');
        } finally {
          setLocating(false);
        }
      },
      () => {
        setLocating(false);
        setError('Location permission was denied.');
      },
      { timeout: 10000, maximumAge: 60000 },
    );
  }

  return (
    <div ref={boxRef} className="relative">
      <div className="flex gap-2">
        <input
          className="field"
          value={text}
          autoFocus={autoFocus}
          placeholder={placeholder}
          onChange={(event) => setText(event.target.value)}
          onFocus={() => results.length > 0 && setOpen(true)}
          autoComplete="off"
        />
        <button
          type="button"
          className="btn-secondary shrink-0 px-3"
          onClick={useMyLocation}
          disabled={locating}
          title="Use my current location"
        >
          {locating ? '…' : '◎'}
        </button>
      </div>

      {busy ? <p className="mt-1 text-xs text-zinc-500">Searching…</p> : null}
      {error ? <p className="mt-1 text-xs text-amber-400">{error}</p> : null}

      {open && results.length > 0 ? (
        <ul className="absolute z-1000 mt-1 max-h-64 w-full overflow-auto rounded-lg border border-zinc-700 bg-ink-850 shadow-2xl">
          {results.map((result) => (
            <li key={`${result.lat},${result.lon},${result.rank}`}>
              <button
                type="button"
                className="block w-full px-3 py-2 text-left text-sm text-zinc-300 hover:bg-ink-800"
                onClick={() => {
                  setText(result.displayName);
                  setOpen(false);
                  onSelect(result);
                }}
              >
                {result.displayName}
              </button>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}

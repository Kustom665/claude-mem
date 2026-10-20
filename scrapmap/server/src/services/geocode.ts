import { createHash } from 'node:crypto';
import { cached } from '../db/cache.ts';
import { env } from '../env.ts';
import { fetchJson } from '../lib/http.ts';
import { createThrottle } from '../lib/throttle.ts';

/**
 * Geocoding via OpenStreetMap Nominatim: free, keyless, and covers addresses
 * worldwide. In exchange it asks for a descriptive User-Agent, at most one
 * request per second, and caching of repeated lookups — all of which we do.
 * https://operations.osmfoundation.org/policies/nominatim/
 */

const throttleNominatim = createThrottle(1100);

const SEARCH_TTL_SECONDS = 7 * 24 * 60 * 60;
const REVERSE_TTL_SECONDS = 30 * 24 * 60 * 60;

export interface GeocodeResult {
  displayName: string;
  lat: number;
  lon: number;
  addressLine: string | null;
  city: string | null;
  region: string | null;
  postalCode: string | null;
  country: string | null;
  /** OSM's own confidence ordering position, 0 being the best match. */
  rank: number;
}

interface NominatimAddress {
  house_number?: string;
  road?: string;
  city?: string;
  town?: string;
  village?: string;
  hamlet?: string;
  municipality?: string;
  suburb?: string;
  county?: string;
  state?: string;
  'ISO3166-2-lvl4'?: string;
  postcode?: string;
  country?: string;
  country_code?: string;
}

interface NominatimPlace {
  lat: string;
  lon: string;
  display_name?: string;
  address?: NominatimAddress;
}

const cacheKey = (kind: string, value: string): string =>
  `geo:${kind}:${createHash('sha1').update(value).digest('hex').slice(0, 20)}`;

function toResult(place: NominatimPlace, rank: number): GeocodeResult | null {
  const lat = Number.parseFloat(place.lat);
  const lon = Number.parseFloat(place.lon);
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null;

  const address = place.address ?? {};
  const streetParts = [address.house_number, address.road].filter(Boolean);
  const region = address.state ?? address['ISO3166-2-lvl4']?.split('-')[1] ?? null;

  return {
    displayName: place.display_name ?? `${lat}, ${lon}`,
    lat,
    lon,
    addressLine: streetParts.length ? streetParts.join(' ') : null,
    city:
      address.city ??
      address.town ??
      address.village ??
      address.hamlet ??
      address.municipality ??
      address.suburb ??
      null,
    region,
    postalCode: address.postcode ?? null,
    country: address.country ?? null,
    rank,
  };
}

/** Forward geocode: free-text address or place name to coordinates. */
export async function searchAddress(
  queryText: string,
  options: { limit?: number; countryCodes?: string } = {},
): Promise<GeocodeResult[]> {
  const trimmed = queryText.trim();
  if (trimmed.length < 3) return [];

  const limit = Math.min(Math.max(options.limit ?? 5, 1), 10);
  const params = new URLSearchParams({
    q: trimmed,
    format: 'jsonv2',
    addressdetails: '1',
    limit: String(limit),
  });
  if (options.countryCodes) params.set('countrycodes', options.countryCodes);

  const url = `${env.nominatimBaseUrl}/search?${params.toString()}`;
  const key = cacheKey('search', `${limit}:${options.countryCodes ?? ''}:${trimmed.toLowerCase()}`);

  const result = await cached(key, SEARCH_TTL_SECONDS, () =>
    throttleNominatim(async () => {
      const places = await fetchJson<NominatimPlace[]>(url, {
        label: 'nominatim/search',
        timeoutMs: 9000,
      });
      return places
        .map((place, index) => toResult(place, index))
        .filter((value): value is GeocodeResult => value !== null);
    }),
  );

  return result.value;
}

/** Reverse geocode: coordinates to a human-readable address. */
export async function reverseGeocode(lat: number, lon: number): Promise<GeocodeResult | null> {
  // Round to ~11m before caching; finer precision only fragments the cache.
  const roundedLat = Number(lat.toFixed(4));
  const roundedLon = Number(lon.toFixed(4));

  const params = new URLSearchParams({
    lat: String(roundedLat),
    lon: String(roundedLon),
    format: 'jsonv2',
    addressdetails: '1',
    zoom: '18',
  });
  const url = `${env.nominatimBaseUrl}/reverse?${params.toString()}`;
  const key = cacheKey('reverse', `${roundedLat},${roundedLon}`);

  const result = await cached(key, REVERSE_TTL_SECONDS, () =>
    throttleNominatim(async () => {
      const place = await fetchJson<NominatimPlace & { error?: string }>(url, {
        label: 'nominatim/reverse',
        timeoutMs: 9000,
      });
      if (place.error) return null;
      return toResult(place, 0);
    }),
  );

  return result.value;
}

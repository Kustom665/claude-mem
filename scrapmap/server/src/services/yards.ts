import { cached } from '../db/cache.ts';
import { env } from '../env.ts';
import { fetchWithRetry } from '../lib/http.ts';
import { createThrottle } from '../lib/throttle.ts';
import { distanceMiles } from '../lib/geo.ts';

/**
 * Scrap yard and recycling centre lookup via the Overpass API, which queries
 * OpenStreetMap's raw data. Free, keyless, and the only open dataset that
 * actually tags scrap dealers. Knowing where to sell is half of "find scrap
 * copper", so this sits alongside the marketplace rather than under it.
 */

const throttleOverpass = createThrottle(1500);
const CACHE_TTL_SECONDS = 24 * 60 * 60;

export interface ScrapYard {
  id: string;
  name: string;
  lat: number;
  lon: number;
  distanceMiles: number;
  kind: 'scrap-yard' | 'recycling-centre' | 'metal-recycling';
  address: string | null;
  phone: string | null;
  website: string | null;
  openingHours: string | null;
  /** OSM tags that told us this place takes scrap metal. */
  acceptsScrapMetal: boolean;
  osmUrl: string;
}

interface OverpassElement {
  type: 'node' | 'way' | 'relation';
  id: number;
  lat?: number;
  lon?: number;
  center?: { lat: number; lon: number };
  tags?: Record<string, string>;
}

interface OverpassResponse {
  elements?: OverpassElement[];
}

/**
 * Overpass QL. Three overlapping tagging conventions exist in OSM for this, so
 * the query unions all of them and dedupes on the way out.
 */
function buildQuery(lat: number, lon: number, radiusMeters: number): string {
  const around = `around:${Math.round(radiusMeters)},${lat.toFixed(5)},${lon.toFixed(5)}`;
  return `[out:json][timeout:25];
(
  nwr["shop"="scrap_yard"](${around});
  nwr["industrial"="scrap_yard"](${around});
  nwr["amenity"="recycling"]["recycling_type"="centre"](${around});
  nwr["amenity"="recycling"]["recycling:scrap_metal"="yes"](${around});
  nwr["amenity"="recycling"]["recycling:metal"="yes"](${around});
);
out center tags 80;`;
}

function classify(tags: Record<string, string>): ScrapYard['kind'] {
  if (tags.shop === 'scrap_yard' || tags.industrial === 'scrap_yard') return 'scrap-yard';
  if (tags['recycling:scrap_metal'] === 'yes' || tags['recycling:metal'] === 'yes') {
    return 'metal-recycling';
  }
  return 'recycling-centre';
}

function formatAddress(tags: Record<string, string>): string | null {
  const parts = [
    [tags['addr:housenumber'], tags['addr:street']].filter(Boolean).join(' '),
    tags['addr:city'],
    tags['addr:state'],
    tags['addr:postcode'],
  ].filter((part): part is string => Boolean(part && part.trim()));
  return parts.length ? parts.join(', ') : null;
}

function toYard(element: OverpassElement, lat: number, lon: number): ScrapYard | null {
  const point = element.center ?? { lat: element.lat, lon: element.lon };
  if (typeof point.lat !== 'number' || typeof point.lon !== 'number') return null;

  const tags = element.tags ?? {};
  const kind = classify(tags);

  return {
    id: `${element.type}/${element.id}`,
    name: tags.name ?? tags.operator ?? (kind === 'scrap-yard' ? 'Scrap yard' : 'Recycling centre'),
    lat: point.lat,
    lon: point.lon,
    distanceMiles: Number(distanceMiles(lat, lon, point.lat, point.lon).toFixed(2)),
    kind,
    address: formatAddress(tags),
    phone: tags.phone ?? tags['contact:phone'] ?? null,
    website: tags.website ?? tags['contact:website'] ?? null,
    openingHours: tags.opening_hours ?? null,
    acceptsScrapMetal:
      kind !== 'recycling-centre' ||
      tags['recycling:scrap_metal'] === 'yes' ||
      tags['recycling:metal'] === 'yes',
    osmUrl: `https://www.openstreetmap.org/${element.type}/${element.id}`,
  };
}

/** Scrap yards and metal recyclers within `radiusMiles`, nearest first. */
export async function findNearbyYards(
  lat: number,
  lon: number,
  radiusMiles = 25,
): Promise<{ yards: ScrapYard[]; freshness: 'live' | 'cache' | 'stale' }> {
  const clampedRadius = Math.min(Math.max(radiusMiles, 1), 100);
  const radiusMeters = clampedRadius * 1609.34;

  // Snap the cache key to a coarse grid so nearby users share one Overpass hit.
  const key = `yards:${lat.toFixed(2)},${lon.toFixed(2)}:${Math.round(clampedRadius)}`;

  const result = await cached(key, CACHE_TTL_SECONDS, () =>
    throttleOverpass(async () => {
      const response = await fetchWithRetry(env.overpassBaseUrl, {
        label: 'overpass',
        method: 'POST',
        body: new URLSearchParams({ data: buildQuery(lat, lon, radiusMeters) }),
        // Overpass is a shared community server and can queue requests for a
        // while under load; it needs a longer leash than the other upstreams.
        timeoutMs: 30000,
        retries: 1,
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          Accept: 'application/json',
        },
      });

      const payload = (await response.json()) as OverpassResponse;
      const yards = (payload.elements ?? [])
        .map((element) => toYard(element, lat, lon))
        .filter((yard): yard is ScrapYard => yard !== null)
        .filter((yard) => yard.distanceMiles <= clampedRadius)
        .sort((a, b) => a.distanceMiles - b.distanceMiles);

      // Deduplicate: OSM often carries both a node and an enclosing way.
      const seen = new Set<string>();
      return yards.filter((yard) => {
        const fingerprint = `${yard.name}|${yard.lat.toFixed(3)},${yard.lon.toFixed(3)}`;
        if (seen.has(fingerprint)) return false;
        seen.add(fingerprint);
        return true;
      });
    }),
  );

  return { yards: result.value, freshness: result.source };
}

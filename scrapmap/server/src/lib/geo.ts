const EARTH_RADIUS_MILES = 3958.7613;

const toRadians = (degrees: number): number => (degrees * Math.PI) / 180;

/** Great-circle distance in miles between two coordinates. */
export function distanceMiles(
  lat1: number,
  lon1: number,
  lat2: number,
  lon2: number,
): number {
  const dLat = toRadians(lat2 - lat1);
  const dLon = toRadians(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRadians(lat1)) * Math.cos(toRadians(lat2)) * Math.sin(dLon / 2) ** 2;
  return 2 * EARTH_RADIUS_MILES * Math.asin(Math.min(1, Math.sqrt(a)));
}

export interface BoundingBox {
  minLat: number;
  maxLat: number;
  minLon: number;
  maxLon: number;
}

/**
 * Bounding box around a point, used to let SQLite narrow candidates with an
 * index before we pay for haversine on the survivors.
 */
export function boundingBox(lat: number, lon: number, radiusMiles: number): BoundingBox {
  const latDelta = radiusMiles / 69.0;
  // Longitude degrees shrink toward the poles; guard against division by ~0.
  const cosLat = Math.max(0.01, Math.cos(toRadians(lat)));
  const lonDelta = radiusMiles / (69.172 * cosLat);
  return {
    minLat: clampLat(lat - latDelta),
    maxLat: clampLat(lat + latDelta),
    minLon: lon - lonDelta,
    maxLon: lon + lonDelta,
  };
}

const clampLat = (lat: number): number => Math.min(90, Math.max(-90, lat));

export const isValidLatitude = (value: number): boolean =>
  Number.isFinite(value) && value >= -90 && value <= 90;

export const isValidLongitude = (value: number): boolean =>
  Number.isFinite(value) && value >= -180 && value <= 180;

/**
 * Coarsens a coordinate so public listing responses do not publish somebody's
 * exact front door. Roughly a 150-250m grid depending on latitude; the precise
 * point is only released once a pickup is accepted.
 */
export function fuzzCoordinate(lat: number, lon: number, seed: string): {
  lat: number;
  lon: number;
} {
  const jitter = (salt: string): number => {
    let hash = 2166136261;
    const input = `${seed}:${salt}`;
    for (let i = 0; i < input.length; i += 1) {
      hash ^= input.charCodeAt(i);
      hash = Math.imul(hash, 16777619);
    }
    // Map the hash into [-1, 1) deterministically.
    return ((hash >>> 0) / 0xffffffff) * 2 - 1;
  };
  const latOffset = jitter('lat') * 0.0016;
  const lonOffset = jitter('lon') * 0.0016;
  return {
    lat: Number((lat + latOffset).toFixed(5)),
    lon: Number((lon + lonOffset).toFixed(5)),
  };
}

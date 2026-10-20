import { useEffect, useMemo, useRef } from 'react';
import { Circle, MapContainer, Marker, Popup, TileLayer, useMap, useMapEvents } from 'react-leaflet';
import L from 'leaflet';
import { Link } from 'react-router-dom';
import type { Listing, ScrapYard } from '../api/types.ts';
import { miles, money, priceLabel, weight } from '../lib/format.ts';

/**
 * OpenStreetMap's standard tiles: free, keyless, and the attribution below is
 * the condition of use. https://operations.osmfoundation.org/policies/tiles/
 */
const TILE_URL = 'https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png';
const TILE_ATTRIBUTION =
  '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors';

/**
 * Leaflet's default marker is a PNG resolved relative to the CSS, which
 * bundlers routinely break. Div icons are pure markup, so they always render —
 * and they let a marker carry its own colour and label.
 */
function pinIcon(options: { color: string; glyph: string; dim?: boolean }): L.DivIcon {
  return L.divIcon({
    className: 'scrapmap-pin',
    html: `<span style="
      display:flex;align-items:center;justify-content:center;
      width:30px;height:30px;border-radius:50% 50% 50% 0;
      transform:rotate(-45deg);
      background:${options.color};
      border:2px solid rgba(255,255,255,.9);
      box-shadow:0 2px 6px rgba(0,0,0,.55);
      opacity:${options.dim ? 0.55 : 1};
    "><span style="transform:rotate(45deg);font-size:13px;line-height:1">${options.glyph}</span></span>`,
    iconSize: [30, 30],
    iconAnchor: [15, 28],
    popupAnchor: [0, -26],
  });
}

const LISTING_ICONS: Record<string, L.DivIcon> = {
  open: pinIcon({ color: '#b87333', glyph: '⚙' }),
  claimed: pinIcon({ color: '#a16207', glyph: '✓' }),
  completed: pinIcon({ color: '#3f3f46', glyph: '✓', dim: true }),
  cancelled: pinIcon({ color: '#3f3f46', glyph: '×', dim: true }),
  expired: pinIcon({ color: '#3f3f46', glyph: '·', dim: true }),
};

const YARD_ICON = pinIcon({ color: '#0284c7', glyph: '⚖' });
const HOME_ICON = pinIcon({ color: '#059669', glyph: '⌂' });
const PICK_ICON = pinIcon({ color: '#dc2626', glyph: '✚' });

/** Keeps the Leaflet view in sync when the surrounding app moves the centre. */
function Recenter({ center, zoom }: { center: [number, number]; zoom?: number }) {
  const map = useMap();
  const last = useRef<string>('');

  useEffect(() => {
    const key = `${center[0].toFixed(5)},${center[1].toFixed(5)},${zoom ?? ''}`;
    if (key === last.current) return;
    last.current = key;
    map.setView(center, zoom ?? map.getZoom(), { animate: true });
  }, [center, zoom, map]);

  return null;
}

/** Turns a map click into a coordinate, used by the "drop a pin" flow. */
function ClickToPick({ onPick }: { onPick: (lat: number, lon: number) => void }) {
  useMapEvents({
    click(event) {
      onPick(event.latlng.lat, event.latlng.lng);
    },
  });
  return null;
}

/** Leaflet mis-sizes itself when its container starts hidden or resizes. */
function InvalidateOnResize() {
  const map = useMap();
  useEffect(() => {
    const observer = new ResizeObserver(() => map.invalidateSize());
    observer.observe(map.getContainer());
    return () => observer.disconnect();
  }, [map]);
  return null;
}

export interface MapViewProps {
  center: [number, number];
  zoom?: number;
  listings?: Listing[];
  yards?: ScrapYard[];
  /** Draws the search radius, in miles. */
  radiusMiles?: number | null;
  homeMarker?: [number, number] | null;
  pickedPoint?: [number, number] | null;
  onPick?: (lat: number, lon: number) => void;
  onListingHover?: (id: string | null) => void;
  highlightId?: string | null;
  className?: string;
}

export function MapView({
  center,
  zoom = 12,
  listings = [],
  yards = [],
  radiusMiles = null,
  homeMarker = null,
  pickedPoint = null,
  onPick,
  onListingHover,
  highlightId = null,
  className = '',
}: MapViewProps) {
  const radiusMeters = useMemo(
    () => (radiusMiles ? radiusMiles * 1609.34 : null),
    [radiusMiles],
  );

  return (
    <MapContainer
      center={center}
      zoom={zoom}
      scrollWheelZoom
      className={`h-full w-full ${className}`}
      // Whole-world wrap makes distance filtering confusing near the date line.
      worldCopyJump
    >
      <TileLayer url={TILE_URL} attribution={TILE_ATTRIBUTION} maxZoom={19} />
      <Recenter center={center} zoom={zoom} />
      <InvalidateOnResize />
      {onPick ? <ClickToPick onPick={onPick} /> : null}

      {radiusMeters ? (
        <Circle
          center={center}
          radius={radiusMeters}
          pathOptions={{
            color: '#b87333',
            weight: 1.5,
            opacity: 0.6,
            fillColor: '#b87333',
            fillOpacity: 0.06,
          }}
        />
      ) : null}

      {homeMarker ? (
        <Marker position={homeMarker} icon={HOME_ICON}>
          <Popup>
            <div className="p-3 text-sm">
              <p className="font-semibold text-zinc-100">Your home base</p>
              <p className="mt-1 text-xs text-zinc-400">
                Distances and alerts are measured from here.
              </p>
            </div>
          </Popup>
        </Marker>
      ) : null}

      {pickedPoint ? (
        <Marker position={pickedPoint} icon={PICK_ICON}>
          <Popup>
            <div className="p-3 text-sm text-zinc-200">Pickup location</div>
          </Popup>
        </Marker>
      ) : null}

      {listings.map((listing) => (
        <Marker
          key={listing.id}
          position={[listing.lat, listing.lon]}
          icon={LISTING_ICONS[listing.status] ?? LISTING_ICONS.open!}
          zIndexOffset={highlightId === listing.id ? 1000 : 0}
          eventHandlers={
            onListingHover
              ? {
                  mouseover: () => onListingHover(listing.id),
                  mouseout: () => onListingHover(null),
                }
              : undefined
          }
        >
          <Popup>
            <div className="p-3">
              <Link
                to={`/listing/${listing.id}`}
                className="block text-sm font-semibold text-copper-300 hover:underline"
              >
                {listing.title}
              </Link>
              <p className="mt-1.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-zinc-400">
                <span className="font-medium text-zinc-300">
                  {priceLabel(listing.priceType, listing.priceCents)}
                </span>
                <span aria-hidden>·</span>
                <span>{weight(listing.totalWeightLbs)}</span>
                {listing.distanceMiles !== null ? (
                  <>
                    <span aria-hidden>·</span>
                    <span>{miles(listing.distanceMiles)}</span>
                  </>
                ) : null}
              </p>
              <p className="mt-1 text-xs text-zinc-500">
                Est. yard value {money(listing.estimatedValueCents)}
              </p>
              {listing.approximateLocation ? (
                <p className="mt-2 text-[11px] text-zinc-600">
                  Approximate location — the exact address is shared once the pickup is accepted.
                </p>
              ) : null}
            </div>
          </Popup>
        </Marker>
      ))}

      {yards.map((yard) => (
        <Marker key={yard.id} position={[yard.lat, yard.lon]} icon={YARD_ICON}>
          <Popup>
            <div className="p-3">
              <p className="text-sm font-semibold text-zinc-100">{yard.name}</p>
              <p className="mt-1 text-xs text-zinc-400">
                {yard.distanceMiles.toFixed(1)} mi
                {yard.address ? ` · ${yard.address}` : ''}
              </p>
              {yard.openingHours ? (
                <p className="mt-1 text-xs text-zinc-500">{yard.openingHours}</p>
              ) : null}
              <div className="mt-2 flex flex-wrap gap-2 text-xs">
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
          </Popup>
        </Marker>
      ))}
    </MapContainer>
  );
}

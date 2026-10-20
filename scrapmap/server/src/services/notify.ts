import { execute, nowIso, query } from '../db/index.ts';
import { newId } from '../lib/ids.ts';
import { boundingBox, distanceMiles } from '../lib/geo.ts';

export type NotificationType =
  | 'listing_nearby'
  | 'claim_received'
  | 'claim_accepted'
  | 'claim_declined'
  | 'message_received'
  | 'listing_completed'
  | 'review_received'
  | 'event_created';

export interface NotificationInput {
  userId: string;
  type: NotificationType;
  title: string;
  body?: string;
  link?: string;
}

export function notify(input: NotificationInput): void {
  execute(
    `INSERT INTO notifications (id, user_id, type, title, body, link, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [
      newId('ntf'),
      input.userId,
      input.type,
      input.title,
      input.body ?? '',
      input.link ?? null,
      nowIso(),
    ],
  );
}

/**
 * Alerts scrappers whose home base and search radius cover a new listing.
 *
 * The bounding box prefilter uses the (lat, lon) index so this stays cheap as
 * the user table grows; haversine only runs on the shortlist.
 */
export function notifyNearbyScrappers(options: {
  listingId: string;
  listingTitle: string;
  lat: number;
  lon: number;
  excludeUserId: string;
  maxRecipients?: number;
}): number {
  // 100 miles is the largest radius a user can configure, so nobody outside
  // this box could possibly match.
  const box = boundingBox(options.lat, options.lon, 100);

  const candidates = query<{
    id: string;
    home_lat: number;
    home_lon: number;
    search_radius_miles: number;
  }>(
    `SELECT id, home_lat, home_lon, search_radius_miles
       FROM users
      WHERE is_active = 1
        AND role IN ('scrapper', 'both')
        AND id != ?
        AND home_lat IS NOT NULL
        AND home_lon IS NOT NULL
        AND home_lat BETWEEN ? AND ?
        AND home_lon BETWEEN ? AND ?`,
    [options.excludeUserId, box.minLat, box.maxLat, box.minLon, box.maxLon],
  );

  const limit = options.maxRecipients ?? 200;
  let sent = 0;

  for (const candidate of candidates) {
    if (sent >= limit) break;
    const miles = distanceMiles(
      options.lat,
      options.lon,
      candidate.home_lat,
      candidate.home_lon,
    );
    if (miles > candidate.search_radius_miles) continue;

    notify({
      userId: candidate.id,
      type: 'listing_nearby',
      title: 'New scrap near you',
      body: `${options.listingTitle} — about ${miles.toFixed(1)} mi away`,
      link: `/listing/${options.listingId}`,
    });
    sent += 1;
  }

  return sent;
}

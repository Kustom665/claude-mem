import { Router } from 'express';
import { z } from 'zod';
import { execute, fromSqlBool, nowIso, query, queryOne, toSqlBool, transaction } from '../db/index.ts';
import { badRequest, conflict, forbidden, notFound } from '../lib/errors.ts';
import { newId } from '../lib/ids.ts';
import { boundingBox, distanceMiles, fuzzCoordinate } from '../lib/geo.ts';
import { param } from '../lib/params.ts';
import {
  boolQuery,
  cleanMultiline,
  cleanText,
  latitude,
  longitude,
  numericQuery,
} from '../lib/validate.ts';
import { asyncHandler } from '../middleware/error.ts';
import { currentUser, requireAuth } from '../middleware/auth.ts';
import { rateLimit } from '../middleware/rateLimit.ts';
import { findProhibitedItem, MATERIALS_BY_KEY } from '../data/materials.ts';
import { estimateValue } from '../services/estimate.ts';
import { getPrices } from '../services/prices.ts';
import { notify, notifyNearbyScrappers } from '../services/notify.ts';

export const listingsRouter: Router = Router();

const DEFAULT_EXPIRY_DAYS = 30;

interface ListingRow {
  id: string;
  user_id: string;
  title: string;
  description: string;
  status: 'open' | 'claimed' | 'completed' | 'cancelled' | 'expired';
  price_type: 'free' | 'obo' | 'firm';
  price_cents: number;
  lat: number;
  lon: number;
  address_line: string | null;
  city: string | null;
  region: string | null;
  postal_code: string | null;
  pickup_notes: string;
  available_from: string | null;
  available_until: string | null;
  curbside: number;
  help_needed: number;
  estimated_value_cents: number;
  total_weight_lbs: number;
  view_count: number;
  community_id: string | null;
  claimed_by: string | null;
  created_at: string;
  updated_at: string;
  expires_at: string | null;
  completed_at: string | null;
  owner_name?: string;
}

interface MaterialRow {
  id: string;
  listing_id: string;
  material_key: string;
  weight_lbs: number;
  quantity: number;
  notes: string;
}

interface PhotoRow {
  id: string;
  listing_id: string;
  filename: string;
  sort_order: number;
}

const materialLineSchema = z.object({
  materialKey: z.string().min(1).max(60),
  weightLbs: z.number().min(0).max(100000),
  quantity: z.number().int().min(1).max(10000).default(1),
  notes: cleanText(200).default(''),
});

const listingInputSchema = z.object({
  title: cleanText(120, 4),
  description: cleanMultiline(4000).default(''),
  priceType: z.enum(['free', 'obo', 'firm']).default('free'),
  priceCents: z.number().int().min(0).max(10_000_00).default(0),
  lat: latitude,
  lon: longitude,
  addressLine: z.string().trim().max(160).nullish(),
  city: z.string().trim().max(80).nullish(),
  region: z.string().trim().max(80).nullish(),
  postalCode: z.string().trim().max(16).nullish(),
  pickupNotes: cleanMultiline(1000).default(''),
  availableFrom: z.string().datetime().nullish(),
  availableUntil: z.string().datetime().nullish(),
  curbside: z.boolean().default(false),
  helpNeeded: z.boolean().default(false),
  communityId: z.string().max(60).nullish(),
  materials: z.array(materialLineSchema).min(1, 'Add at least one material.').max(20),
});

/**
 * Exact coordinates are only shared once a pickup is arranged. Everyone else
 * sees a jittered point, which is enough to judge distance without publishing
 * where the copper is sitting unattended.
 */
function serializeListing(
  row: ListingRow,
  options: {
    materials: MaterialRow[];
    photos: PhotoRow[];
    viewerId: string | null;
    origin?: { lat: number; lon: number } | null;
  },
) {
  const isOwner = options.viewerId === row.user_id;
  const isClaimant = options.viewerId !== null && options.viewerId === row.claimed_by;
  const preciseAllowed = isOwner || isClaimant;
  const point = preciseAllowed
    ? { lat: row.lat, lon: row.lon }
    : fuzzCoordinate(row.lat, row.lon, row.id);

  return {
    id: row.id,
    title: row.title,
    description: row.description,
    status: row.status,
    priceType: row.price_type,
    priceCents: row.price_cents,
    lat: point.lat,
    lon: point.lon,
    approximateLocation: !preciseAllowed,
    addressLine: preciseAllowed ? row.address_line : null,
    city: row.city,
    region: row.region,
    postalCode: row.postal_code,
    pickupNotes: preciseAllowed ? row.pickup_notes : '',
    availableFrom: row.available_from,
    availableUntil: row.available_until,
    curbside: fromSqlBool(row.curbside),
    helpNeeded: fromSqlBool(row.help_needed),
    estimatedValueCents: row.estimated_value_cents,
    totalWeightLbs: row.total_weight_lbs,
    viewCount: row.view_count,
    communityId: row.community_id,
    ownerId: row.user_id,
    ownerName: row.owner_name ?? null,
    claimedBy: row.claimed_by,
    isOwner,
    isClaimant,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    expiresAt: row.expires_at,
    completedAt: row.completed_at,
    distanceMiles: options.origin
      ? Number(distanceMiles(options.origin.lat, options.origin.lon, row.lat, row.lon).toFixed(2))
      : null,
    materials: options.materials.map((material) => {
      const catalog = MATERIALS_BY_KEY.get(material.material_key);
      return {
        materialKey: material.material_key,
        materialName: catalog?.name ?? material.material_key,
        category: catalog?.category ?? 'other',
        weightLbs: material.weight_lbs,
        quantity: material.quantity,
        notes: material.notes,
      };
    }),
    photos: options.photos.map((photo) => ({
      id: photo.id,
      url: `/uploads/${photo.filename}`,
    })),
  };
}

function loadMaterials(listingIds: string[]): Map<string, MaterialRow[]> {
  if (listingIds.length === 0) return new Map();
  const placeholders = listingIds.map(() => '?').join(', ');
  const rows = query<MaterialRow>(
    `SELECT * FROM listing_materials WHERE listing_id IN (${placeholders})`,
    listingIds,
  );
  const grouped = new Map<string, MaterialRow[]>();
  for (const row of rows) {
    const list = grouped.get(row.listing_id) ?? [];
    list.push(row);
    grouped.set(row.listing_id, list);
  }
  return grouped;
}

function loadPhotos(listingIds: string[]): Map<string, PhotoRow[]> {
  if (listingIds.length === 0) return new Map();
  const placeholders = listingIds.map(() => '?').join(', ');
  const rows = query<PhotoRow>(
    `SELECT id, listing_id, filename, sort_order
       FROM listing_photos
      WHERE listing_id IN (${placeholders})
      ORDER BY sort_order, created_at`,
    listingIds,
  );
  const grouped = new Map<string, PhotoRow[]>();
  for (const row of rows) {
    const list = grouped.get(row.listing_id) ?? [];
    list.push(row);
    grouped.set(row.listing_id, list);
  }
  return grouped;
}

const browseSchema = z.object({
  lat: numericQuery(),
  lon: numericQuery(),
  radiusMiles: numericQuery(25),
  status: z.enum(['open', 'claimed', 'completed', 'any']).default('open'),
  category: z.string().max(40).optional(),
  materialKey: z.string().max(60).optional(),
  priceType: z.enum(['free', 'obo', 'firm']).optional(),
  curbside: boolQuery,
  minValueCents: numericQuery(),
  search: z.string().max(120).optional(),
  communityId: z.string().max(60).optional(),
  ownerId: z.string().max(60).optional(),
  claimedBy: z.string().max(60).optional(),
  sort: z.enum(['newest', 'closest', 'value', 'weight']).default('newest'),
  limit: numericQuery(40),
  offset: numericQuery(0),
});

listingsRouter.get(
  '/',
  asyncHandler(async (req, res) => {
    const params = browseSchema.parse(req.query);
    const viewer = req.user ?? null;

    const conditions: string[] = [];
    const values: unknown[] = [];

    if (params.status !== 'any') {
      conditions.push('l.status = ?');
      values.push(params.status);
    } else {
      conditions.push("l.status IN ('open', 'claimed', 'completed')");
    }

    // Fall back to the viewer's saved home base so "near me" works with no args.
    const originLat = params.lat ?? viewer?.homeLat ?? null;
    const originLon = params.lon ?? viewer?.homeLon ?? null;
    const hasOrigin = originLat !== null && originLon !== null;
    const radius = Math.min(Math.max(params.radiusMiles ?? 25, 1), 500);

    if (hasOrigin) {
      const box = boundingBox(originLat, originLon, radius);
      conditions.push('l.lat BETWEEN ? AND ?', 'l.lon BETWEEN ? AND ?');
      values.push(box.minLat, box.maxLat, box.minLon, box.maxLon);
    }

    if (params.priceType) {
      conditions.push('l.price_type = ?');
      values.push(params.priceType);
    }
    if (params.curbside !== undefined) {
      conditions.push('l.curbside = ?');
      values.push(toSqlBool(params.curbside));
    }
    if (params.minValueCents !== undefined) {
      conditions.push('l.estimated_value_cents >= ?');
      values.push(params.minValueCents);
    }
    if (params.communityId) {
      conditions.push('l.community_id = ?');
      values.push(params.communityId);
    }
    if (params.ownerId) {
      conditions.push('l.user_id = ?');
      values.push(params.ownerId);
    }
    if (params.claimedBy) {
      conditions.push('l.claimed_by = ?');
      values.push(params.claimedBy);
    }
    if (params.search) {
      conditions.push('(l.title LIKE ? OR l.description LIKE ? OR l.city LIKE ?)');
      const like = `%${params.search.replace(/[%_]/g, '')}%`;
      values.push(like, like, like);
    }
    if (params.materialKey) {
      conditions.push(
        'EXISTS (SELECT 1 FROM listing_materials m WHERE m.listing_id = l.id AND m.material_key = ?)',
      );
      values.push(params.materialKey);
    }
    if (params.category) {
      const keys = [...MATERIALS_BY_KEY.values()]
        .filter((material) => material.category === params.category)
        .map((material) => material.key);
      if (keys.length === 0) {
        res.json({ listings: [], total: 0, hasMore: false });
        return;
      }
      conditions.push(
        `EXISTS (SELECT 1 FROM listing_materials m
                  WHERE m.listing_id = l.id
                    AND m.material_key IN (${keys.map(() => '?').join(', ')}))`,
      );
      values.push(...keys);
    }

    const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
    const orderBy =
      params.sort === 'value'
        ? 'l.estimated_value_cents DESC'
        : params.sort === 'weight'
          ? 'l.total_weight_lbs DESC'
          : 'l.created_at DESC';

    // Distance sorting needs haversine, which SQLite cannot index. Pull the
    // bounding-box candidates and rank them in memory instead.
    const needsDistanceSort = params.sort === 'closest' && hasOrigin;
    const limit = Math.min(Math.max(params.limit ?? 40, 1), 100);
    const offset = Math.max(params.offset ?? 0, 0);
    const fetchLimit = needsDistanceSort ? 500 : limit;
    const fetchOffset = needsDistanceSort ? 0 : offset;

    let rows = query<ListingRow>(
      `SELECT l.*, u.display_name AS owner_name
         FROM listings l
         JOIN users u ON u.id = l.user_id
         ${where}
        ORDER BY ${orderBy}
        LIMIT ? OFFSET ?`,
      [...values, fetchLimit, fetchOffset],
    );

    // The bounding box is a square; trim the corners to a true circle.
    if (hasOrigin) {
      rows = rows.filter(
        (row) => distanceMiles(originLat, originLon, row.lat, row.lon) <= radius,
      );
    }

    const total = rows.length;

    if (needsDistanceSort) {
      rows.sort(
        (a, b) =>
          distanceMiles(originLat, originLon, a.lat, a.lon) -
          distanceMiles(originLat, originLon, b.lat, b.lon),
      );
      rows = rows.slice(offset, offset + limit);
    }

    const ids = rows.map((row) => row.id);
    const materials = loadMaterials(ids);
    const photos = loadPhotos(ids);

    res.json({
      listings: rows.map((row) =>
        serializeListing(row, {
          materials: materials.get(row.id) ?? [],
          photos: photos.get(row.id) ?? [],
          viewerId: viewer?.id ?? null,
          origin: hasOrigin ? { lat: originLat, lon: originLon } : null,
        }),
      ),
      total,
      hasMore: needsDistanceSort ? offset + limit < total : rows.length === limit,
      origin: hasOrigin ? { lat: originLat, lon: originLon, radiusMiles: radius } : null,
    });
  }),
);

listingsRouter.post(
  '/',
  requireAuth,
  rateLimit({ windowMs: 60 * 60 * 1000, max: 30, keyPrefix: 'post-listing' }),
  asyncHandler(async (req, res) => {
    const input = listingInputSchema.parse(req.body);
    const user = currentUser(req);

    const prohibited = findProhibitedItem(input.title, input.description, input.pickupNotes);
    if (prohibited) {
      throw badRequest(
        `ScrapMap does not list ${prohibited}. These items are commonly tied to metal theft ` +
          'and are restricted or illegal to resell in many areas.',
        { reason: 'prohibited_item', item: prohibited },
      );
    }

    for (const line of input.materials) {
      if (!MATERIALS_BY_KEY.has(line.materialKey)) {
        throw badRequest(`Unknown material: ${line.materialKey}`);
      }
    }

    if (input.priceType === 'free' && input.priceCents > 0) {
      throw badRequest('A free listing cannot have a price.');
    }
    if (input.priceType !== 'free' && input.priceCents <= 0) {
      throw badRequest('Set a price, or mark the listing free.');
    }

    if (input.communityId) {
      const member = queryOne<{ community_id: string }>(
        'SELECT community_id FROM community_members WHERE community_id = ? AND user_id = ?',
        [input.communityId, user.id],
      );
      if (!member) throw forbidden('Join that community before posting to it.');
    }

    const prices = await getPrices();
    const estimate = estimateValue(input.materials, prices);

    const id = newId('lst');
    const now = nowIso();
    const expiresAt = new Date(
      Date.now() + DEFAULT_EXPIRY_DAYS * 24 * 60 * 60 * 1000,
    ).toISOString();

    transaction(() => {
      execute(
        `INSERT INTO listings (
           id, user_id, title, description, status, price_type, price_cents,
           lat, lon, address_line, city, region, postal_code, pickup_notes,
           available_from, available_until, curbside, help_needed,
           estimated_value_cents, total_weight_lbs, community_id,
           created_at, updated_at, expires_at
         ) VALUES (?, ?, ?, ?, 'open', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          id,
          user.id,
          input.title,
          input.description,
          input.priceType,
          input.priceCents,
          input.lat,
          input.lon,
          input.addressLine ?? null,
          input.city ?? null,
          input.region ?? null,
          input.postalCode ?? null,
          input.pickupNotes,
          input.availableFrom ?? null,
          input.availableUntil ?? null,
          toSqlBool(input.curbside),
          toSqlBool(input.helpNeeded),
          estimate.totalValueCents,
          estimate.totalWeightLbs,
          input.communityId ?? null,
          now,
          now,
          expiresAt,
        ],
      );

      for (const line of input.materials) {
        execute(
          `INSERT INTO listing_materials (id, listing_id, material_key, weight_lbs, quantity, notes)
           VALUES (?, ?, ?, ?, ?, ?)`,
          [newId('mat'), id, line.materialKey, line.weightLbs, line.quantity, line.notes],
        );
      }
    });

    const notified = notifyNearbyScrappers({
      listingId: id,
      listingTitle: input.title,
      lat: input.lat,
      lon: input.lon,
      excludeUserId: user.id,
    });

    const row = queryOne<ListingRow>(
      `SELECT l.*, u.display_name AS owner_name FROM listings l
         JOIN users u ON u.id = l.user_id WHERE l.id = ?`,
      [id],
    );
    if (!row) throw notFound('Listing could not be loaded after saving.');

    res.status(201).json({
      listing: serializeListing(row, {
        materials: loadMaterials([id]).get(id) ?? [],
        photos: [],
        viewerId: user.id,
      }),
      estimate,
      scrappersNotified: notified,
    });
  }),
);

listingsRouter.get(
  '/:id',
  asyncHandler(async (req, res) => {
    const row = queryOne<ListingRow>(
      `SELECT l.*, u.display_name AS owner_name FROM listings l
         JOIN users u ON u.id = l.user_id WHERE l.id = ?`,
      [param(req, 'id')],
    );
    if (!row) throw notFound('That listing is gone or never existed.');

    const viewer = req.user ?? null;
    if (viewer?.id !== row.user_id) {
      execute('UPDATE listings SET view_count = view_count + 1 WHERE id = ?', [row.id]);
      row.view_count += 1;
    }

    const claimCount = queryOne<{ count: number }>(
      "SELECT COUNT(*) AS count FROM claims WHERE listing_id = ? AND status = 'pending'",
      [row.id],
    );

    const myClaim = viewer
      ? queryOne<{ id: string; status: string }>(
          'SELECT id, status FROM claims WHERE listing_id = ? AND scrapper_id = ?',
          [row.id, viewer.id],
        )
      : null;

    res.json({
      listing: serializeListing(row, {
        materials: loadMaterials([row.id]).get(row.id) ?? [],
        photos: loadPhotos([row.id]).get(row.id) ?? [],
        viewerId: viewer?.id ?? null,
        origin:
          viewer?.homeLat != null && viewer.homeLon != null
            ? { lat: viewer.homeLat, lon: viewer.homeLon }
            : null,
      }),
      pendingClaims: claimCount?.count ?? 0,
      myClaim: myClaim ? { id: myClaim.id, status: myClaim.status } : null,
    });
  }),
);

const updateListingSchema = listingInputSchema.partial().extend({
  status: z.enum(['open', 'cancelled', 'completed']).optional(),
});

listingsRouter.patch(
  '/:id',
  requireAuth,
  asyncHandler(async (req, res) => {
    const input = updateListingSchema.parse(req.body);
    const user = currentUser(req);

    const row = queryOne<ListingRow>('SELECT * FROM listings WHERE id = ?', [param(req, 'id')]);
    if (!row) throw notFound('That listing is gone or never existed.');
    if (row.user_id !== user.id) throw forbidden('Only the person who posted it can edit it.');

    const prohibited = findProhibitedItem(input.title, input.description, input.pickupNotes);
    if (prohibited) {
      throw badRequest(`ScrapMap does not list ${prohibited}.`, {
        reason: 'prohibited_item',
        item: prohibited,
      });
    }

    const assignments: string[] = [];
    const values: unknown[] = [];
    const set = (column: string, value: unknown): void => {
      assignments.push(`${column} = ?`);
      values.push(value);
    };

    if (input.title !== undefined) set('title', input.title);
    if (input.description !== undefined) set('description', input.description);
    if (input.priceType !== undefined) set('price_type', input.priceType);
    if (input.priceCents !== undefined) set('price_cents', input.priceCents);
    if (input.lat !== undefined) set('lat', input.lat);
    if (input.lon !== undefined) set('lon', input.lon);
    if (input.addressLine !== undefined) set('address_line', input.addressLine);
    if (input.city !== undefined) set('city', input.city);
    if (input.region !== undefined) set('region', input.region);
    if (input.postalCode !== undefined) set('postal_code', input.postalCode);
    if (input.pickupNotes !== undefined) set('pickup_notes', input.pickupNotes);
    if (input.availableFrom !== undefined) set('available_from', input.availableFrom);
    if (input.availableUntil !== undefined) set('available_until', input.availableUntil);
    if (input.curbside !== undefined) set('curbside', toSqlBool(input.curbside));
    if (input.helpNeeded !== undefined) set('help_needed', toSqlBool(input.helpNeeded));

    if (input.status !== undefined) {
      set('status', input.status);
      if (input.status === 'completed') set('completed_at', nowIso());
      // Reopening should also clear the accepted claimant.
      if (input.status === 'open') set('claimed_by', null);
    }

    // Re-price when the material list changes; the stored estimate is a
    // snapshot, so it has to move with the contents.
    let estimate = null;
    if (input.materials !== undefined) {
      for (const line of input.materials) {
        if (!MATERIALS_BY_KEY.has(line.materialKey)) {
          throw badRequest(`Unknown material: ${line.materialKey}`);
        }
      }
      estimate = estimateValue(input.materials, await getPrices());
      set('estimated_value_cents', estimate.totalValueCents);
      set('total_weight_lbs', estimate.totalWeightLbs);
    }

    set('updated_at', nowIso());

    transaction(() => {
      execute(`UPDATE listings SET ${assignments.join(', ')} WHERE id = ?`, [
        ...values,
        row.id,
      ]);

      if (input.materials !== undefined) {
        execute('DELETE FROM listing_materials WHERE listing_id = ?', [row.id]);
        for (const line of input.materials) {
          execute(
            `INSERT INTO listing_materials (id, listing_id, material_key, weight_lbs, quantity, notes)
             VALUES (?, ?, ?, ?, ?, ?)`,
            [newId('mat'), row.id, line.materialKey, line.weightLbs, line.quantity, line.notes],
          );
        }
      }
    });

    // Tell the accepted scrapper if a pickup they are driving to changed.
    if (row.claimed_by && row.claimed_by !== user.id) {
      notify({
        userId: row.claimed_by,
        type: 'listing_completed',
        title: 'A pickup you claimed was updated',
        body: input.status === 'cancelled' ? 'The poster cancelled it.' : 'Check the new details.',
        link: `/listing/${row.id}`,
      });
    }

    const updated = queryOne<ListingRow>(
      `SELECT l.*, u.display_name AS owner_name FROM listings l
         JOIN users u ON u.id = l.user_id WHERE l.id = ?`,
      [row.id],
    );
    if (!updated) throw notFound('Listing vanished mid-update.');

    res.json({
      listing: serializeListing(updated, {
        materials: loadMaterials([row.id]).get(row.id) ?? [],
        photos: loadPhotos([row.id]).get(row.id) ?? [],
        viewerId: user.id,
      }),
      estimate,
    });
  }),
);

listingsRouter.delete(
  '/:id',
  requireAuth,
  asyncHandler(async (req, res) => {
    const user = currentUser(req);
    const row = queryOne<ListingRow>('SELECT * FROM listings WHERE id = ?', [param(req, 'id')]);
    if (!row) throw notFound('That listing is gone or never existed.');
    if (row.user_id !== user.id) throw forbidden('Only the person who posted it can delete it.');
    if (row.status === 'completed') {
      throw conflict('Completed pickups stay on the record; they cannot be deleted.');
    }

    execute('DELETE FROM listings WHERE id = ?', [row.id]);
    res.json({ ok: true });
  }),
);

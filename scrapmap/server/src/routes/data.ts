import { Router } from 'express';
import { z } from 'zod';
import { query, queryOne } from '../db/index.ts';
import { badRequest } from '../lib/errors.ts';
import { latitude, longitude, numericQuery } from '../lib/validate.ts';
import { asyncHandler } from '../middleware/error.ts';
import { rateLimit } from '../middleware/rateLimit.ts';
import {
  CATEGORY_LABELS,
  MATERIALS,
  PROHIBITED_ITEMS,
  MATERIALS_BY_KEY,
} from '../data/materials.ts';
import { estimateValue, ratePerLb, WEIGHT_HINTS } from '../services/estimate.ts';
import { getPrices } from '../services/prices.ts';
import { searchAddress, reverseGeocode } from '../services/geocode.ts';
import { findNearbyYards } from '../services/yards.ts';
import { getWeather } from '../services/weather.ts';

/**
 * Read-only reference data and the third-party API proxies.
 *
 * Every upstream is proxied rather than called from the browser: it keeps the
 * required User-Agent attached, funnels everything through one shared cache
 * instead of one-cache-per-visitor, and means a rate limit hits us rather than
 * getting the user's IP blocked by a free service.
 */
export const dataRouter: Router = Router();

// ------------------------------------------------------------- reference

dataRouter.get(
  '/materials',
  asyncHandler(async (_req, res) => {
    const prices = await getPrices();

    res.json({
      categories: Object.entries(CATEGORY_LABELS).map(([key, label]) => ({ key, label })),
      materials: MATERIALS.map((material) => {
        const { usdPerLb, isLive } = ratePerLb(material, prices);
        return {
          key: material.key,
          name: material.name,
          category: material.category,
          categoryLabel: CATEGORY_LABELS[material.category],
          basis: material.basis,
          yardPct: material.yardPct,
          unit: material.unit,
          description: material.description,
          foundIn: material.foundIn,
          upgradeTip: material.upgradeTip ?? null,
          magnetic: material.magnetic,
          estimatedUsdPerLb: Number(usdPerLb.toFixed(4)),
          priceIsLive: isLive,
        };
      }),
      weightHints: WEIGHT_HINTS,
      prohibitedItems: [...new Set(PROHIBITED_ITEMS.map((item) => item.label))],
      prices,
    });
  }),
);

dataRouter.get(
  '/prices',
  asyncHandler(async (_req, res) => {
    res.json(await getPrices());
  }),
);

const estimateSchema = z.object({
  materials: z
    .array(
      z.object({
        materialKey: z.string().min(1).max(60),
        weightLbs: z.number().min(0).max(100000),
        quantity: z.number().int().min(1).max(10000).optional(),
      }),
    )
    .min(1)
    .max(20),
});

dataRouter.post(
  '/prices/estimate',
  asyncHandler(async (req, res) => {
    const input = estimateSchema.parse(req.body);
    for (const line of input.materials) {
      if (!MATERIALS_BY_KEY.has(line.materialKey)) {
        throw badRequest(`Unknown material: ${line.materialKey}`);
      }
    }
    res.json(estimateValue(input.materials, await getPrices()));
  }),
);

// ------------------------------------------------------------- geocoding

const geoSearchSchema = z.object({
  q: z.string().min(3).max(200),
  limit: numericQuery(5),
  countryCodes: z.string().max(40).optional(),
});

dataRouter.get(
  '/geo/search',
  rateLimit({ windowMs: 60 * 1000, max: 30, keyPrefix: 'geo-search' }),
  asyncHandler(async (req, res) => {
    const params = geoSearchSchema.parse(req.query);
    const results = await searchAddress(params.q, {
      limit: params.limit,
      countryCodes: params.countryCodes,
    });
    res.json({ results, attribution: 'Geocoding © OpenStreetMap contributors (ODbL)' });
  }),
);

const geoReverseSchema = z.object({ lat: latitude, lon: longitude });

dataRouter.get(
  '/geo/reverse',
  rateLimit({ windowMs: 60 * 1000, max: 30, keyPrefix: 'geo-reverse' }),
  asyncHandler(async (req, res) => {
    const params = geoReverseSchema.parse({
      lat: Number(req.query.lat),
      lon: Number(req.query.lon),
    });
    const result = await reverseGeocode(params.lat, params.lon);
    res.json({ result, attribution: 'Geocoding © OpenStreetMap contributors (ODbL)' });
  }),
);

// ----------------------------------------------------------- scrap yards

const yardsSchema = z.object({
  lat: latitude,
  lon: longitude,
  radiusMiles: z.number().min(1).max(100).default(25),
});

dataRouter.get(
  '/yards',
  rateLimit({ windowMs: 60 * 1000, max: 12, keyPrefix: 'yards' }),
  asyncHandler(async (req, res) => {
    const params = yardsSchema.parse({
      lat: Number(req.query.lat),
      lon: Number(req.query.lon),
      radiusMiles: req.query.radiusMiles ? Number(req.query.radiusMiles) : 25,
    });

    const { yards, freshness } = await findNearbyYards(
      params.lat,
      params.lon,
      params.radiusMiles,
    );

    res.json({
      yards,
      freshness,
      attribution: 'Places © OpenStreetMap contributors (ODbL), via Overpass API',
      note:
        'Listings come from community-maintained OpenStreetMap data. Call ahead — hours, ' +
        'accepted grades, and whether a yard buys from the public all vary.',
    });
  }),
);

// --------------------------------------------------------------- weather

const weatherSchema = z.object({
  lat: latitude,
  lon: longitude,
  days: z.number().int().min(1).max(14).default(7),
});

dataRouter.get(
  '/weather',
  rateLimit({ windowMs: 60 * 1000, max: 30, keyPrefix: 'weather' }),
  asyncHandler(async (req, res) => {
    const params = weatherSchema.parse({
      lat: Number(req.query.lat),
      lon: Number(req.query.lon),
      days: req.query.days ? Number(req.query.days) : 7,
    });
    res.json(await getWeather(params.lat, params.lon, params.days));
  }),
);

// ----------------------------------------------------------------- stats

dataRouter.get(
  '/stats',
  asyncHandler(async (_req, res) => {
    const totals = queryOne<{
      completed: number;
      pounds: number | null;
      value_cents: number | null;
      open_listings: number;
      members: number;
      communities: number;
    }>(
      `SELECT
         (SELECT COUNT(*) FROM listings WHERE status = 'completed') AS completed,
         (SELECT SUM(total_weight_lbs) FROM listings WHERE status = 'completed') AS pounds,
         (SELECT SUM(estimated_value_cents) FROM listings WHERE status = 'completed') AS value_cents,
         (SELECT COUNT(*) FROM listings WHERE status = 'open') AS open_listings,
         (SELECT COUNT(*) FROM users WHERE is_active = 1) AS members,
         (SELECT COUNT(*) FROM communities) AS communities`,
    );

    const topScrappers = query<{
      id: string;
      display_name: string;
      pickups: number;
      pounds: number | null;
    }>(
      `SELECT u.id, u.display_name,
              COUNT(l.id) AS pickups,
              SUM(l.total_weight_lbs) AS pounds
         FROM listings l
         JOIN users u ON u.id = l.claimed_by
        WHERE l.status = 'completed'
        GROUP BY u.id
        ORDER BY pounds DESC
        LIMIT 10`,
    );

    const topPosters = query<{
      id: string;
      display_name: string;
      posts: number;
      pounds: number | null;
    }>(
      `SELECT u.id, u.display_name,
              COUNT(l.id) AS posts,
              SUM(l.total_weight_lbs) AS pounds
         FROM listings l
         JOIN users u ON u.id = l.user_id
        WHERE l.status = 'completed'
        GROUP BY u.id
        ORDER BY pounds DESC
        LIMIT 10`,
    );

    const byMaterial = query<{ material_key: string; pounds: number | null }>(
      `SELECT m.material_key, SUM(m.weight_lbs) AS pounds
         FROM listing_materials m
         JOIN listings l ON l.id = m.listing_id
        WHERE l.status = 'completed'
        GROUP BY m.material_key
        ORDER BY pounds DESC
        LIMIT 12`,
    );

    const pounds = totals?.pounds ?? 0;

    res.json({
      totals: {
        completedPickups: totals?.completed ?? 0,
        poundsDiverted: Number(pounds.toFixed(1)),
        // Landfill diversion, expressed the way a community newsletter would.
        tonsDiverted: Number((pounds / 2000).toFixed(2)),
        estimatedValueCents: totals?.value_cents ?? 0,
        openListings: totals?.open_listings ?? 0,
        members: totals?.members ?? 0,
        communities: totals?.communities ?? 0,
      },
      leaderboard: {
        scrappers: topScrappers.map((row) => ({
          id: row.id,
          displayName: row.display_name,
          pickups: row.pickups,
          poundsDiverted: Number((row.pounds ?? 0).toFixed(1)),
        })),
        posters: topPosters.map((row) => ({
          id: row.id,
          displayName: row.display_name,
          posts: row.posts,
          poundsDiverted: Number((row.pounds ?? 0).toFixed(1)),
        })),
      },
      byMaterial: byMaterial.map((row) => ({
        materialKey: row.material_key,
        materialName: MATERIALS_BY_KEY.get(row.material_key)?.name ?? row.material_key,
        poundsDiverted: Number((row.pounds ?? 0).toFixed(1)),
      })),
    });
  }),
);

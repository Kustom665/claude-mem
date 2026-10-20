import { Router } from 'express';
import { z } from 'zod';
import { execute, nowIso, query, queryOne } from '../db/index.ts';
import { notFound } from '../lib/errors.ts';
import { displayName, latitude, longitude, cleanMultiline } from '../lib/validate.ts';
import { param } from '../lib/params.ts';
import { asyncHandler } from '../middleware/error.ts';
import { currentUser, requireAuth } from '../middleware/auth.ts';

export interface UserRow {
  id: string;
  email: string;
  password_hash: string;
  display_name: string;
  role: 'homeowner' | 'scrapper' | 'both';
  bio: string;
  phone: string | null;
  home_lat: number | null;
  home_lon: number | null;
  city: string | null;
  region: string | null;
  postal_code: string | null;
  search_radius_miles: number;
  token_version: number;
  is_active: number;
  created_at: string;
  updated_at: string;
}

export interface PublicUser {
  id: string;
  displayName: string;
  role: UserRow['role'];
  bio: string;
  city: string | null;
  region: string | null;
  memberSince: string;
  rating: number | null;
  reviewCount: number;
  completedPickups: number;
  poundsDiverted: number;
  /** Only present on the authenticated user's own record. */
  email?: string;
  phone?: string | null;
  homeLat?: number | null;
  homeLon?: number | null;
  postalCode?: string | null;
  searchRadiusMiles?: number;
  unreadNotifications?: number;
}

interface ReputationRow {
  rating: number | null;
  review_count: number;
}

function reputation(userId: string): ReputationRow {
  return (
    queryOne<ReputationRow>(
      'SELECT ROUND(AVG(rating), 2) AS rating, COUNT(*) AS review_count FROM reviews WHERE ratee_id = ?',
      [userId],
    ) ?? { rating: null, review_count: 0 }
  );
}

/**
 * Pounds of metal a user has personally moved: what they hauled away as a
 * scrapper plus what they diverted as a poster. Completed listings only.
 */
function impact(userId: string): { completedPickups: number; poundsDiverted: number } {
  const row = queryOne<{ pickups: number; pounds: number | null }>(
    `SELECT COUNT(*) AS pickups, SUM(total_weight_lbs) AS pounds
       FROM listings
      WHERE status = 'completed' AND (claimed_by = ? OR user_id = ?)`,
    [userId, userId],
  );
  return {
    completedPickups: row?.pickups ?? 0,
    poundsDiverted: Number((row?.pounds ?? 0).toFixed(1)),
  };
}

/** Serialises a user row. `includePrivate` adds fields only the owner may see. */
export function publicUser(row: UserRow, includePrivate = false): PublicUser {
  const { rating, review_count } = reputation(row.id);
  const { completedPickups, poundsDiverted } = impact(row.id);

  const base: PublicUser = {
    id: row.id,
    displayName: row.display_name,
    role: row.role,
    bio: row.bio,
    city: row.city,
    region: row.region,
    memberSince: row.created_at,
    rating,
    reviewCount: review_count,
    completedPickups,
    poundsDiverted,
  };

  if (!includePrivate) return base;

  const unread = queryOne<{ count: number }>(
    'SELECT COUNT(*) AS count FROM notifications WHERE user_id = ? AND read_at IS NULL',
    [row.id],
  );

  return {
    ...base,
    email: row.email,
    phone: row.phone,
    homeLat: row.home_lat,
    homeLon: row.home_lon,
    postalCode: row.postal_code,
    searchRadiusMiles: row.search_radius_miles,
    unreadNotifications: unread?.count ?? 0,
  };
}

export const usersRouter: Router = Router();

const updateProfileSchema = z.object({
  displayName: displayName.optional(),
  bio: cleanMultiline(600).optional(),
  phone: z.string().trim().max(32).nullish(),
  role: z.enum(['homeowner', 'scrapper', 'both']).optional(),
  homeLat: latitude.nullish(),
  homeLon: longitude.nullish(),
  city: z.string().trim().max(80).nullish(),
  region: z.string().trim().max(80).nullish(),
  postalCode: z.string().trim().max(16).nullish(),
  searchRadiusMiles: z.number().min(1).max(100).optional(),
});

/** Column mapping for the partial profile update below. */
const PROFILE_COLUMNS: Record<string, string> = {
  displayName: 'display_name',
  bio: 'bio',
  phone: 'phone',
  role: 'role',
  homeLat: 'home_lat',
  homeLon: 'home_lon',
  city: 'city',
  region: 'region',
  postalCode: 'postal_code',
  searchRadiusMiles: 'search_radius_miles',
};

usersRouter.patch(
  '/me',
  requireAuth,
  asyncHandler(async (req, res) => {
    const input = updateProfileSchema.parse(req.body);
    const user = currentUser(req);

    const assignments: string[] = [];
    const values: unknown[] = [];
    for (const [field, column] of Object.entries(PROFILE_COLUMNS)) {
      const value = (input as Record<string, unknown>)[field];
      if (value === undefined) continue;
      assignments.push(`${column} = ?`);
      values.push(value);
    }

    if (assignments.length > 0) {
      assignments.push('updated_at = ?');
      values.push(nowIso(), user.id);
      execute(`UPDATE users SET ${assignments.join(', ')} WHERE id = ?`, values);
    }

    const row = queryOne<UserRow>('SELECT * FROM users WHERE id = ?', [user.id]);
    if (!row) throw notFound('Your account could not be loaded.');
    res.json({ user: publicUser(row, true) });
  }),
);

usersRouter.get(
  '/:id',
  asyncHandler(async (req, res) => {
    const row = queryOne<UserRow>('SELECT * FROM users WHERE id = ? AND is_active = 1', [
      param(req, 'id'),
    ]);
    if (!row) throw notFound('No such member.');

    const recentReviews = query<{
      rating: number;
      comment: string;
      created_at: string;
      rater_name: string;
    }>(
      `SELECT r.rating, r.comment, r.created_at, u.display_name AS rater_name
         FROM reviews r
         JOIN users u ON u.id = r.rater_id
        WHERE r.ratee_id = ?
        ORDER BY r.created_at DESC
        LIMIT 10`,
      [row.id],
    );

    res.json({
      user: publicUser(row),
      reviews: recentReviews.map((review) => ({
        rating: review.rating,
        comment: review.comment,
        createdAt: review.created_at,
        raterName: review.rater_name,
      })),
    });
  }),
);

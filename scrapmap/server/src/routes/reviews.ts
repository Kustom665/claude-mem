import { Router } from 'express';
import { z } from 'zod';
import { execute, nowIso, queryOne } from '../db/index.ts';
import { badRequest, conflict, forbidden, notFound } from '../lib/errors.ts';
import { newId } from '../lib/ids.ts';
import { cleanMultiline } from '../lib/validate.ts';
import { asyncHandler } from '../middleware/error.ts';
import { currentUser, requireAuth } from '../middleware/auth.ts';
import { notify } from '../services/notify.ts';

export const reviewsRouter: Router = Router();

const createReviewSchema = z.object({
  listingId: z.string().min(1).max(60),
  rating: z.number().int().min(1).max(5),
  comment: cleanMultiline(1000).default(''),
});

/**
 * Ratings are only possible between the two people who actually completed a
 * pickup together, one per listing per side. That constraint is what keeps the
 * reputation number meaningful.
 */
reviewsRouter.post(
  '/',
  requireAuth,
  asyncHandler(async (req, res) => {
    const input = createReviewSchema.parse(req.body);
    const user = currentUser(req);

    const listing = queryOne<{
      id: string;
      user_id: string;
      claimed_by: string | null;
      status: string;
      title: string;
    }>('SELECT id, user_id, claimed_by, status, title FROM listings WHERE id = ?', [
      input.listingId,
    ]);

    if (!listing) throw notFound('That listing is gone or never existed.');
    if (listing.status !== 'completed') {
      throw conflict('You can rate someone once the pickup is marked complete.');
    }
    if (!listing.claimed_by) throw badRequest('That pickup has no scrapper on record.');

    const isOwner = listing.user_id === user.id;
    const isScrapper = listing.claimed_by === user.id;
    if (!isOwner && !isScrapper) throw forbidden('Only the two people involved can leave a rating.');

    const rateeId = isOwner ? listing.claimed_by : listing.user_id;

    const existing = queryOne<{ id: string }>(
      'SELECT id FROM reviews WHERE listing_id = ? AND rater_id = ?',
      [listing.id, user.id],
    );
    if (existing) throw conflict('You already rated this pickup.');

    execute(
      `INSERT INTO reviews (id, listing_id, rater_id, ratee_id, rating, comment, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [newId('rev'), listing.id, user.id, rateeId, input.rating, input.comment, nowIso()],
    );

    notify({
      userId: rateeId,
      type: 'review_received',
      title: `${user.displayName} left you ${input.rating} stars`,
      body: input.comment.slice(0, 140),
      link: `/profile/${rateeId}`,
    });

    res.status(201).json({ ok: true, rateeId });
  }),
);

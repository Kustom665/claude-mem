import { Router } from 'express';
import { z } from 'zod';
import { execute, nowIso, query, queryOne, transaction } from '../db/index.ts';
import { badRequest, conflict, forbidden, notFound } from '../lib/errors.ts';
import { newId } from '../lib/ids.ts';
import { cleanMultiline } from '../lib/validate.ts';
import { param } from '../lib/params.ts';
import { asyncHandler } from '../middleware/error.ts';
import { currentUser, requireAuth } from '../middleware/auth.ts';
import { rateLimit } from '../middleware/rateLimit.ts';
import { notify } from '../services/notify.ts';

export const claimsRouter: Router = Router();

interface ClaimRow {
  id: string;
  listing_id: string;
  scrapper_id: string;
  status: 'pending' | 'accepted' | 'declined' | 'withdrawn' | 'completed';
  message: string;
  eta: string | null;
  created_at: string;
  updated_at: string;
  scrapper_name?: string;
  scrapper_rating?: number | null;
  scrapper_pickups?: number;
  listing_title?: string;
  listing_status?: string;
  listing_owner?: string;
}

const serializeClaim = (row: ClaimRow) => ({
  id: row.id,
  listingId: row.listing_id,
  listingTitle: row.listing_title ?? null,
  listingStatus: row.listing_status ?? null,
  scrapperId: row.scrapper_id,
  scrapperName: row.scrapper_name ?? null,
  scrapperRating: row.scrapper_rating ?? null,
  scrapperPickups: row.scrapper_pickups ?? 0,
  status: row.status,
  message: row.message,
  eta: row.eta,
  createdAt: row.created_at,
  updatedAt: row.updated_at,
});

const CLAIM_SELECT = `
  SELECT c.*,
         u.display_name AS scrapper_name,
         (SELECT ROUND(AVG(rating), 2) FROM reviews WHERE ratee_id = c.scrapper_id) AS scrapper_rating,
         (SELECT COUNT(*) FROM listings WHERE claimed_by = c.scrapper_id AND status = 'completed')
           AS scrapper_pickups,
         l.title AS listing_title,
         l.status AS listing_status,
         l.user_id AS listing_owner
    FROM claims c
    JOIN users u ON u.id = c.scrapper_id
    JOIN listings l ON l.id = c.listing_id`;

const createClaimSchema = z.object({
  message: cleanMultiline(1000).default(''),
  eta: z.string().datetime().nullish(),
});

/** A scrapper offers to take a listing. */
claimsRouter.post(
  '/listings/:listingId/claims',
  requireAuth,
  rateLimit({ windowMs: 60 * 60 * 1000, max: 60, keyPrefix: 'claim' }),
  asyncHandler(async (req, res) => {
    const input = createClaimSchema.parse(req.body);
    const user = currentUser(req);

    const listing = queryOne<{
      id: string;
      user_id: string;
      title: string;
      status: string;
    }>('SELECT id, user_id, title, status FROM listings WHERE id = ?', [param(req, 'listingId')]);

    if (!listing) throw notFound('That listing is gone or never existed.');
    if (listing.user_id === user.id) throw badRequest('You cannot claim your own listing.');
    if (listing.status !== 'open') {
      throw conflict('That listing is no longer open for pickup.');
    }

    const existing = queryOne<ClaimRow>(
      'SELECT * FROM claims WHERE listing_id = ? AND scrapper_id = ?',
      [listing.id, user.id],
    );

    const now = nowIso();

    if (existing) {
      if (existing.status === 'pending' || existing.status === 'accepted') {
        throw conflict('You already have an active claim on this listing.');
      }
      // Let a scrapper who withdrew or was declined try again.
      execute(
        "UPDATE claims SET status = 'pending', message = ?, eta = ?, updated_at = ? WHERE id = ?",
        [input.message, input.eta ?? null, now, existing.id],
      );
    } else {
      execute(
        `INSERT INTO claims (id, listing_id, scrapper_id, status, message, eta, created_at, updated_at)
         VALUES (?, ?, ?, 'pending', ?, ?, ?, ?)`,
        [newId('clm'), listing.id, user.id, input.message, input.eta ?? null, now, now],
      );
    }

    notify({
      userId: listing.user_id,
      type: 'claim_received',
      title: 'Someone wants to pick this up',
      body: `${user.displayName} offered to collect "${listing.title}".`,
      link: `/listing/${listing.id}`,
    });

    const row = queryOne<ClaimRow>(
      `${CLAIM_SELECT} WHERE c.listing_id = ? AND c.scrapper_id = ?`,
      [listing.id, user.id],
    );
    res.status(201).json({ claim: row ? serializeClaim(row) : null });
  }),
);

/** Owners see every claim on their listing; scrappers see only their own. */
claimsRouter.get(
  '/listings/:listingId/claims',
  requireAuth,
  asyncHandler(async (req, res) => {
    const user = currentUser(req);
    const listing = queryOne<{ id: string; user_id: string }>(
      'SELECT id, user_id FROM listings WHERE id = ?',
      [param(req, 'listingId')],
    );
    if (!listing) throw notFound('That listing is gone or never existed.');

    const isOwner = listing.user_id === user.id;
    const rows = isOwner
      ? query<ClaimRow>(`${CLAIM_SELECT} WHERE c.listing_id = ? ORDER BY c.created_at DESC`, [
          listing.id,
        ])
      : query<ClaimRow>(
          `${CLAIM_SELECT} WHERE c.listing_id = ? AND c.scrapper_id = ?`,
          [listing.id, user.id],
        );

    res.json({ claims: rows.map(serializeClaim), isOwner });
  }),
);

/** Every claim the signed-in user has made, for the scrapper dashboard. */
claimsRouter.get(
  '/claims/mine',
  requireAuth,
  asyncHandler(async (req, res) => {
    const rows = query<ClaimRow>(
      `${CLAIM_SELECT} WHERE c.scrapper_id = ? ORDER BY c.created_at DESC LIMIT 100`,
      [currentUser(req).id],
    );
    res.json({ claims: rows.map(serializeClaim) });
  }),
);

const updateClaimSchema = z.object({
  action: z.enum(['accept', 'decline', 'withdraw', 'complete']),
});

claimsRouter.patch(
  '/claims/:id',
  requireAuth,
  asyncHandler(async (req, res) => {
    const { action } = updateClaimSchema.parse(req.body);
    const user = currentUser(req);

    const claim = queryOne<ClaimRow>(`${CLAIM_SELECT} WHERE c.id = ?`, [param(req, 'id')]);
    if (!claim) throw notFound('No such claim.');

    const isOwner = claim.listing_owner === user.id;
    const isScrapper = claim.scrapper_id === user.id;
    if (!isOwner && !isScrapper) throw forbidden('That claim is not yours.');

    const now = nowIso();

    switch (action) {
      case 'accept': {
        if (!isOwner) throw forbidden('Only the poster can accept a claim.');
        if (claim.status !== 'pending') throw conflict('That claim is no longer pending.');

        transaction(() => {
          execute("UPDATE claims SET status = 'accepted', updated_at = ? WHERE id = ?", [
            now,
            claim.id,
          ]);
          // One pickup per listing: everyone else gets a clear answer.
          execute(
            `UPDATE claims SET status = 'declined', updated_at = ?
              WHERE listing_id = ? AND id != ? AND status = 'pending'`,
            [now, claim.listing_id, claim.id],
          );
          execute(
            "UPDATE listings SET status = 'claimed', claimed_by = ?, updated_at = ? WHERE id = ?",
            [claim.scrapper_id, now, claim.listing_id],
          );
        });

        notify({
          userId: claim.scrapper_id,
          type: 'claim_accepted',
          title: 'Your pickup was accepted',
          body: `You're on for "${claim.listing_title}". The full address is on the listing now.`,
          link: `/listing/${claim.listing_id}`,
        });
        break;
      }

      case 'decline': {
        if (!isOwner) throw forbidden('Only the poster can decline a claim.');
        if (claim.status === 'completed') throw conflict('That pickup already happened.');

        transaction(() => {
          execute("UPDATE claims SET status = 'declined', updated_at = ? WHERE id = ?", [
            now,
            claim.id,
          ]);
          // Declining the accepted claim puts the listing back on the map.
          if (claim.status === 'accepted') {
            execute(
              "UPDATE listings SET status = 'open', claimed_by = NULL, updated_at = ? WHERE id = ?",
              [now, claim.listing_id],
            );
          }
        });

        notify({
          userId: claim.scrapper_id,
          type: 'claim_declined',
          title: 'A claim was declined',
          body: `"${claim.listing_title}" went another way.`,
          link: `/listing/${claim.listing_id}`,
        });
        break;
      }

      case 'withdraw': {
        if (!isScrapper) throw forbidden('Only the scrapper can withdraw their claim.');
        if (claim.status === 'completed') throw conflict('That pickup already happened.');

        transaction(() => {
          execute("UPDATE claims SET status = 'withdrawn', updated_at = ? WHERE id = ?", [
            now,
            claim.id,
          ]);
          if (claim.status === 'accepted') {
            execute(
              "UPDATE listings SET status = 'open', claimed_by = NULL, updated_at = ? WHERE id = ?",
              [now, claim.listing_id],
            );
          }
        });

        if (claim.listing_owner) {
          notify({
            userId: claim.listing_owner,
            type: 'claim_declined',
            title: 'A scrapper withdrew',
            body: `"${claim.listing_title}" is open again.`,
            link: `/listing/${claim.listing_id}`,
          });
        }
        break;
      }

      case 'complete': {
        if (claim.status !== 'accepted') {
          throw conflict('Only an accepted pickup can be marked complete.');
        }

        transaction(() => {
          execute("UPDATE claims SET status = 'completed', updated_at = ? WHERE id = ?", [
            now,
            claim.id,
          ]);
          execute(
            "UPDATE listings SET status = 'completed', completed_at = ?, updated_at = ? WHERE id = ?",
            [now, now, claim.listing_id],
          );
        });

        // Nudge the other party to close the loop with a rating.
        const otherParty = isOwner ? claim.scrapper_id : claim.listing_owner;
        if (otherParty) {
          notify({
            userId: otherParty,
            type: 'listing_completed',
            title: 'Pickup marked complete',
            body: `"${claim.listing_title}" is done. Leave a rating?`,
            link: `/listing/${claim.listing_id}`,
          });
        }
        break;
      }
    }

    const updated = queryOne<ClaimRow>(`${CLAIM_SELECT} WHERE c.id = ?`, [claim.id]);
    res.json({ claim: updated ? serializeClaim(updated) : null });
  }),
);

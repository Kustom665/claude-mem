import { Router } from 'express';
import { z } from 'zod';
import { execute, nowIso, query, queryOne } from '../db/index.ts';
import { forbidden, notFound } from '../lib/errors.ts';
import { newId } from '../lib/ids.ts';
import { cleanMultiline } from '../lib/validate.ts';
import { param } from '../lib/params.ts';
import { asyncHandler } from '../middleware/error.ts';
import { currentUser, requireAuth } from '../middleware/auth.ts';
import { rateLimit } from '../middleware/rateLimit.ts';
import { notify } from '../services/notify.ts';

export const messagesRouter: Router = Router();

interface MessageRow {
  id: string;
  listing_id: string;
  sender_id: string;
  recipient_id: string;
  body: string;
  read_at: string | null;
  created_at: string;
  sender_name?: string;
}

const serializeMessage = (row: MessageRow, viewerId: string) => ({
  id: row.id,
  listingId: row.listing_id,
  senderId: row.sender_id,
  senderName: row.sender_name ?? null,
  recipientId: row.recipient_id,
  body: row.body,
  readAt: row.read_at,
  createdAt: row.created_at,
  isMine: row.sender_id === viewerId,
});

/**
 * A conversation is scoped to one listing between two people. Working out who
 * the counterparty is depends on which side the viewer is on.
 */
function resolveCounterparty(listingId: string, viewerId: string, requested?: string): {
  otherId: string;
  listingTitle: string;
} {
  const listing = queryOne<{ id: string; user_id: string; title: string }>(
    'SELECT id, user_id, title FROM listings WHERE id = ?',
    [listingId],
  );
  if (!listing) throw notFound('That listing is gone or never existed.');

  if (listing.user_id === viewerId) {
    // The poster must say who they are replying to; anyone who has claimed or
    // already messaged about the listing is fair game.
    if (!requested) throw forbidden('Specify which member you are replying to.');
    const known = queryOne<{ id: string }>(
      `SELECT u.id FROM users u
        WHERE u.id = ?
          AND (EXISTS (SELECT 1 FROM claims c WHERE c.listing_id = ? AND c.scrapper_id = u.id)
               OR EXISTS (SELECT 1 FROM messages m WHERE m.listing_id = ? AND m.sender_id = u.id))`,
      [requested, listingId, listingId],
    );
    if (!known) throw forbidden('That member has not contacted you about this listing.');
    return { otherId: requested, listingTitle: listing.title };
  }

  // Anyone else is talking to the poster.
  return { otherId: listing.user_id, listingTitle: listing.title };
}

messagesRouter.get(
  '/listings/:listingId/messages',
  requireAuth,
  asyncHandler(async (req, res) => {
    const user = currentUser(req);
    const listingId = param(req, 'listingId');
    const withUser = typeof req.query.with === 'string' ? req.query.with : undefined;
    const { otherId } = resolveCounterparty(listingId, user.id, withUser);

    const rows = query<MessageRow>(
      `SELECT m.*, u.display_name AS sender_name
         FROM messages m
         JOIN users u ON u.id = m.sender_id
        WHERE m.listing_id = ?
          AND ((m.sender_id = ? AND m.recipient_id = ?) OR (m.sender_id = ? AND m.recipient_id = ?))
        ORDER BY m.created_at ASC
        LIMIT 500`,
      [listingId, user.id, otherId, otherId, user.id],
    );

    execute(
      'UPDATE messages SET read_at = ? WHERE listing_id = ? AND recipient_id = ? AND sender_id = ? AND read_at IS NULL',
      [nowIso(), listingId, user.id, otherId],
    );

    res.json({ messages: rows.map((row) => serializeMessage(row, user.id)), withUserId: otherId });
  }),
);

const sendMessageSchema = z.object({
  body: cleanMultiline(2000, 1),
  to: z.string().max(60).optional(),
});

messagesRouter.post(
  '/listings/:listingId/messages',
  requireAuth,
  rateLimit({ windowMs: 60 * 1000, max: 30, keyPrefix: 'message' }),
  asyncHandler(async (req, res) => {
    const input = sendMessageSchema.parse(req.body);
    const user = currentUser(req);
    const listingId = param(req, 'listingId');
    const { otherId, listingTitle } = resolveCounterparty(listingId, user.id, input.to);

    const id = newId('msg');
    execute(
      `INSERT INTO messages (id, listing_id, sender_id, recipient_id, body, created_at)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [id, listingId, user.id, otherId, input.body, nowIso()],
    );

    notify({
      userId: otherId,
      type: 'message_received',
      title: `Message from ${user.displayName}`,
      body: input.body.slice(0, 120),
      link: `/listing/${listingId}`,
    });

    const row = queryOne<MessageRow>(
      `SELECT m.*, u.display_name AS sender_name FROM messages m
         JOIN users u ON u.id = m.sender_id WHERE m.id = ?`,
      [id],
    );

    res.status(201).json({
      message: row ? serializeMessage(row, user.id) : null,
      listingTitle,
    });
  }),
);

/** Inbox: the latest message per listing-and-counterparty pair. */
messagesRouter.get(
  '/threads',
  requireAuth,
  asyncHandler(async (req, res) => {
    const user = currentUser(req);
    const rows = query<{
      listing_id: string;
      listing_title: string;
      listing_status: string;
      other_id: string;
      other_name: string;
      body: string;
      created_at: string;
      unread: number;
    }>(
      `WITH thread AS (
         SELECT m.*,
                CASE WHEN m.sender_id = ? THEN m.recipient_id ELSE m.sender_id END AS other_id
           FROM messages m
          WHERE m.sender_id = ? OR m.recipient_id = ?
       )
       SELECT t.listing_id,
              l.title AS listing_title,
              l.status AS listing_status,
              t.other_id,
              u.display_name AS other_name,
              t.body,
              t.created_at,
              (SELECT COUNT(*) FROM messages m2
                WHERE m2.listing_id = t.listing_id
                  AND m2.sender_id = t.other_id
                  AND m2.recipient_id = ?
                  AND m2.read_at IS NULL) AS unread
         FROM thread t
         JOIN listings l ON l.id = t.listing_id
         JOIN users u ON u.id = t.other_id
        WHERE t.created_at = (
                SELECT MAX(t2.created_at) FROM thread t2
                 WHERE t2.listing_id = t.listing_id AND t2.other_id = t.other_id
              )
        GROUP BY t.listing_id, t.other_id
        ORDER BY t.created_at DESC
        LIMIT 100`,
      [user.id, user.id, user.id, user.id],
    );

    res.json({
      threads: rows.map((row) => ({
        listingId: row.listing_id,
        listingTitle: row.listing_title,
        listingStatus: row.listing_status,
        withUserId: row.other_id,
        withUserName: row.other_name,
        lastMessage: row.body,
        lastMessageAt: row.created_at,
        unread: row.unread,
      })),
    });
  }),
);

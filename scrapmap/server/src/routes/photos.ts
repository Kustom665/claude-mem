import { randomBytes } from 'node:crypto';
import { unlink, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { Router, raw } from 'express';
import { execute, nowIso, queryOne, query } from '../db/index.ts';
import { env } from '../env.ts';
import { badRequest, conflict, forbidden, notFound } from '../lib/errors.ts';
import { newId } from '../lib/ids.ts';
import { param } from '../lib/params.ts';
import { asyncHandler } from '../middleware/error.ts';
import { currentUser, requireAuth } from '../middleware/auth.ts';
import { rateLimit } from '../middleware/rateLimit.ts';

/**
 * Photos are posted one per request as a raw image body rather than multipart.
 * The client already has a File object, so `body: file` is the whole upload
 * path, and it keeps a parsing dependency out of the tree for a feature this
 * small. Multiple photos means multiple requests, which also gives the UI
 * natural per-file progress.
 */
export const photosRouter: Router = Router();

const ACCEPTED = ['image/jpeg', 'image/png', 'image/webp'] as const;

/**
 * Trusting the Content-Type header alone would let anything be stored as an
 * image, so the bytes have to agree with it.
 */
function detectImageType(buffer: Buffer): (typeof ACCEPTED)[number] | null {
  if (buffer.length < 12) return null;
  if (buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) return 'image/jpeg';
  if (
    buffer[0] === 0x89 &&
    buffer[1] === 0x50 &&
    buffer[2] === 0x4e &&
    buffer[3] === 0x47 &&
    buffer[4] === 0x0d &&
    buffer[5] === 0x0a &&
    buffer[6] === 0x1a &&
    buffer[7] === 0x0a
  ) {
    return 'image/png';
  }
  if (
    buffer.toString('ascii', 0, 4) === 'RIFF' &&
    buffer.toString('ascii', 8, 12) === 'WEBP'
  ) {
    return 'image/webp';
  }
  return null;
}

const EXTENSIONS: Record<(typeof ACCEPTED)[number], string> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
};

photosRouter.post(
  '/listings/:listingId/photos',
  requireAuth,
  rateLimit({ windowMs: 60 * 60 * 1000, max: 100, keyPrefix: 'photo-upload' }),
  raw({ type: [...ACCEPTED], limit: env.maxUploadBytes }),
  asyncHandler(async (req, res) => {
    const user = currentUser(req);

    const listing = queryOne<{ id: string; user_id: string }>(
      'SELECT id, user_id FROM listings WHERE id = ?',
      [param(req, 'listingId')],
    );
    if (!listing) throw notFound('That listing is gone or never existed.');
    if (listing.user_id !== user.id) throw forbidden('Only the poster can add photos.');

    const body = req.body;
    if (!Buffer.isBuffer(body) || body.length === 0) {
      throw badRequest(
        'Send the image as the raw request body with a Content-Type of image/jpeg, image/png, or image/webp.',
      );
    }

    const detected = detectImageType(body);
    if (!detected) throw badRequest('That file is not a JPEG, PNG, or WebP image.');

    const existing = queryOne<{ count: number }>(
      'SELECT COUNT(*) AS count FROM listing_photos WHERE listing_id = ?',
      [listing.id],
    );
    if ((existing?.count ?? 0) >= env.maxPhotosPerListing) {
      throw conflict(`A listing can have at most ${env.maxPhotosPerListing} photos.`);
    }

    const id = newId('pht');
    // Random filenames: sequential ones would let anyone enumerate uploads.
    const filename = `${randomBytes(16).toString('hex')}.${EXTENSIONS[detected]}`;
    await writeFile(join(env.uploadDir, filename), body);

    execute(
      `INSERT INTO listing_photos (id, listing_id, filename, byte_size, mime_type, sort_order, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [id, listing.id, filename, body.length, detected, existing?.count ?? 0, nowIso()],
    );

    res.status(201).json({ photo: { id, url: `/uploads/${filename}` } });
  }),
);

photosRouter.get(
  '/listings/:listingId/photos',
  asyncHandler(async (req, res) => {
    const rows = query<{ id: string; filename: string }>(
      'SELECT id, filename FROM listing_photos WHERE listing_id = ? ORDER BY sort_order, created_at',
      [param(req, 'listingId')],
    );
    res.json({ photos: rows.map((row) => ({ id: row.id, url: `/uploads/${row.filename}` })) });
  }),
);

photosRouter.delete(
  '/photos/:id',
  requireAuth,
  asyncHandler(async (req, res) => {
    const user = currentUser(req);
    const photo = queryOne<{ id: string; filename: string; owner: string }>(
      `SELECT p.id, p.filename, l.user_id AS owner
         FROM listing_photos p
         JOIN listings l ON l.id = p.listing_id
        WHERE p.id = ?`,
      [param(req, 'id')],
    );
    if (!photo) throw notFound('No such photo.');
    if (photo.owner !== user.id) throw forbidden('Only the poster can remove photos.');

    execute('DELETE FROM listing_photos WHERE id = ?', [photo.id]);
    // The row is the source of truth; a leftover file is harmless if this fails.
    await unlink(join(env.uploadDir, photo.filename)).catch(() => undefined);

    res.json({ ok: true });
  }),
);

import { Router } from 'express';
import { z } from 'zod';
import { execute, nowIso, query, queryOne } from '../db/index.ts';
import { asyncHandler } from '../middleware/error.ts';
import { currentUser, requireAuth } from '../middleware/auth.ts';

export const notificationsRouter: Router = Router();

interface NotificationRow {
  id: string;
  type: string;
  title: string;
  body: string;
  link: string | null;
  read_at: string | null;
  created_at: string;
}

notificationsRouter.get(
  '/',
  requireAuth,
  asyncHandler(async (req, res) => {
    const user = currentUser(req);
    const unreadOnly = req.query.unread === '1' || req.query.unread === 'true';

    const rows = query<NotificationRow>(
      `SELECT id, type, title, body, link, read_at, created_at
         FROM notifications
        WHERE user_id = ? ${unreadOnly ? 'AND read_at IS NULL' : ''}
        ORDER BY created_at DESC
        LIMIT 100`,
      [user.id],
    );

    const unread = queryOne<{ count: number }>(
      'SELECT COUNT(*) AS count FROM notifications WHERE user_id = ? AND read_at IS NULL',
      [user.id],
    );

    res.json({
      notifications: rows.map((row) => ({
        id: row.id,
        type: row.type,
        title: row.title,
        body: row.body,
        link: row.link,
        readAt: row.read_at,
        createdAt: row.created_at,
      })),
      unread: unread?.count ?? 0,
    });
  }),
);

const markReadSchema = z.object({
  /** Omit to mark everything read. */
  ids: z.array(z.string().max(60)).max(200).optional(),
});

notificationsRouter.post(
  '/read',
  requireAuth,
  asyncHandler(async (req, res) => {
    const input = markReadSchema.parse(req.body ?? {});
    const user = currentUser(req);
    const now = nowIso();

    if (input.ids && input.ids.length > 0) {
      const placeholders = input.ids.map(() => '?').join(', ');
      execute(
        `UPDATE notifications SET read_at = ?
          WHERE user_id = ? AND read_at IS NULL AND id IN (${placeholders})`,
        [now, user.id, ...input.ids],
      );
    } else {
      execute('UPDATE notifications SET read_at = ? WHERE user_id = ? AND read_at IS NULL', [
        now,
        user.id,
      ]);
    }

    res.json({ ok: true });
  }),
);

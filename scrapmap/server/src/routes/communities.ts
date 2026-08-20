import { Router } from 'express';
import { z } from 'zod';
import { execute, nowIso, query, queryOne, transaction } from '../db/index.ts';
import { conflict, forbidden, notFound } from '../lib/errors.ts';
import { newId, slugify } from '../lib/ids.ts';
import { boundingBox, distanceMiles } from '../lib/geo.ts';
import { param } from '../lib/params.ts';
import {
  cleanMultiline,
  cleanText,
  latitude,
  longitude,
  numericQuery,
} from '../lib/validate.ts';
import { asyncHandler } from '../middleware/error.ts';
import { currentUser, requireAuth } from '../middleware/auth.ts';
import { rateLimit } from '../middleware/rateLimit.ts';
import { notify } from '../services/notify.ts';

export const communitiesRouter: Router = Router();

interface CommunityRow {
  id: string;
  slug: string;
  name: string;
  description: string;
  city: string | null;
  region: string | null;
  postal_code: string | null;
  lat: number | null;
  lon: number | null;
  radius_miles: number;
  created_by: string;
  created_at: string;
  member_count?: number;
  open_listings?: number;
  pounds_diverted?: number | null;
}

const COMMUNITY_SELECT = `
  SELECT c.*,
         (SELECT COUNT(*) FROM community_members cm WHERE cm.community_id = c.id) AS member_count,
         (SELECT COUNT(*) FROM listings l WHERE l.community_id = c.id AND l.status = 'open')
           AS open_listings,
         (SELECT SUM(l.total_weight_lbs) FROM listings l
           WHERE l.community_id = c.id AND l.status = 'completed') AS pounds_diverted
    FROM communities c`;

const serializeCommunity = (row: CommunityRow, extra: { isMember?: boolean } = {}) => ({
  id: row.id,
  slug: row.slug,
  name: row.name,
  description: row.description,
  city: row.city,
  region: row.region,
  postalCode: row.postal_code,
  lat: row.lat,
  lon: row.lon,
  radiusMiles: row.radius_miles,
  createdBy: row.created_by,
  createdAt: row.created_at,
  memberCount: row.member_count ?? 0,
  openListings: row.open_listings ?? 0,
  poundsDiverted: Number((row.pounds_diverted ?? 0).toFixed(1)),
  ...(extra.isMember === undefined ? {} : { isMember: extra.isMember }),
});

const browseSchema = z.object({
  lat: numericQuery(),
  lon: numericQuery(),
  radiusMiles: numericQuery(50),
  search: z.string().max(80).optional(),
  mine: z.enum(['0', '1']).optional(),
});

communitiesRouter.get(
  '/',
  asyncHandler(async (req, res) => {
    const params = browseSchema.parse(req.query);
    const viewer = req.user ?? null;

    const conditions: string[] = [];
    const values: unknown[] = [];

    const originLat = params.lat ?? viewer?.homeLat ?? null;
    const originLon = params.lon ?? viewer?.homeLon ?? null;
    const hasOrigin = originLat !== null && originLon !== null;
    const radius = Math.min(Math.max(params.radiusMiles ?? 50, 1), 500);

    if (hasOrigin) {
      const box = boundingBox(originLat, originLon, radius);
      conditions.push('c.lat BETWEEN ? AND ?', 'c.lon BETWEEN ? AND ?');
      values.push(box.minLat, box.maxLat, box.minLon, box.maxLon);
    }
    if (params.search) {
      const like = `%${params.search.replace(/[%_]/g, '')}%`;
      conditions.push('(c.name LIKE ? OR c.city LIKE ? OR c.postal_code LIKE ?)');
      values.push(like, like, like);
    }
    if (params.mine === '1') {
      if (!viewer) throw forbidden('Sign in to see your groups.');
      conditions.push(
        'EXISTS (SELECT 1 FROM community_members cm WHERE cm.community_id = c.id AND cm.user_id = ?)',
      );
      values.push(viewer.id);
    }

    const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
    let rows = query<CommunityRow>(
      `${COMMUNITY_SELECT} ${where} ORDER BY member_count DESC, c.created_at DESC LIMIT 100`,
      values,
    );

    if (hasOrigin) {
      rows = rows
        .filter(
          (row) =>
            row.lat === null ||
            row.lon === null ||
            distanceMiles(originLat, originLon, row.lat, row.lon) <= radius,
        )
        .sort((a, b) => {
          if (a.lat === null || a.lon === null) return 1;
          if (b.lat === null || b.lon === null) return -1;
          return (
            distanceMiles(originLat, originLon, a.lat, a.lon) -
            distanceMiles(originLat, originLon, b.lat, b.lon)
          );
        });
    }

    const memberships = viewer
      ? new Set(
          query<{ community_id: string }>(
            'SELECT community_id FROM community_members WHERE user_id = ?',
            [viewer.id],
          ).map((row) => row.community_id),
        )
      : new Set<string>();

    res.json({
      communities: rows.map((row) =>
        serializeCommunity(row, viewer ? { isMember: memberships.has(row.id) } : {}),
      ),
    });
  }),
);

const createCommunitySchema = z.object({
  name: cleanText(80, 3),
  description: cleanMultiline(2000).default(''),
  city: z.string().trim().max(80).nullish(),
  region: z.string().trim().max(80).nullish(),
  postalCode: z.string().trim().max(16).nullish(),
  lat: latitude.nullish(),
  lon: longitude.nullish(),
  radiusMiles: z.number().min(1).max(100).default(15),
});

communitiesRouter.post(
  '/',
  requireAuth,
  rateLimit({ windowMs: 24 * 60 * 60 * 1000, max: 5, keyPrefix: 'create-community' }),
  asyncHandler(async (req, res) => {
    const input = createCommunitySchema.parse(req.body);
    const user = currentUser(req);

    // Slugs are the public URL, so collisions get a numeric suffix.
    const base = slugify(input.name);
    let slug = base;
    for (let attempt = 2; attempt < 100; attempt += 1) {
      const taken = queryOne<{ id: string }>('SELECT id FROM communities WHERE slug = ?', [slug]);
      if (!taken) break;
      slug = `${base}-${attempt}`;
    }

    const id = newId('cmy');
    const now = nowIso();

    transaction(() => {
      execute(
        `INSERT INTO communities (
           id, slug, name, description, city, region, postal_code,
           lat, lon, radius_miles, created_by, created_at
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          id,
          slug,
          input.name,
          input.description,
          input.city ?? null,
          input.region ?? null,
          input.postalCode ?? null,
          input.lat ?? null,
          input.lon ?? null,
          input.radiusMiles,
          user.id,
          now,
        ],
      );
      execute(
        "INSERT INTO community_members (community_id, user_id, role, joined_at) VALUES (?, ?, 'organizer', ?)",
        [id, user.id, now],
      );
    });

    const row = queryOne<CommunityRow>(`${COMMUNITY_SELECT} WHERE c.id = ?`, [id]);
    res.status(201).json({ community: row ? serializeCommunity(row, { isMember: true }) : null });
  }),
);

/** Accepts either the opaque id or the human-readable slug. */
function findCommunity(idOrSlug: string): CommunityRow {
  const row = queryOne<CommunityRow>(`${COMMUNITY_SELECT} WHERE c.id = ? OR c.slug = ?`, [
    idOrSlug,
    idOrSlug,
  ]);
  if (!row) throw notFound('No such community.');
  return row;
}

communitiesRouter.get(
  '/:idOrSlug',
  asyncHandler(async (req, res) => {
    const row = findCommunity(param(req, 'idOrSlug'));
    const viewer = req.user ?? null;

    const membership = viewer
      ? queryOne<{ role: string }>(
          'SELECT role FROM community_members WHERE community_id = ? AND user_id = ?',
          [row.id, viewer.id],
        )
      : null;

    const members = query<{ id: string; display_name: string; role: string; joined_at: string }>(
      `SELECT u.id, u.display_name, cm.role, cm.joined_at
         FROM community_members cm
         JOIN users u ON u.id = cm.user_id
        WHERE cm.community_id = ?
        ORDER BY cm.role DESC, cm.joined_at ASC
        LIMIT 200`,
      [row.id],
    );

    res.json({
      community: serializeCommunity(row, { isMember: Boolean(membership) }),
      myRole: membership?.role ?? null,
      members: members.map((member) => ({
        id: member.id,
        displayName: member.display_name,
        role: member.role,
        joinedAt: member.joined_at,
      })),
    });
  }),
);

communitiesRouter.post(
  '/:idOrSlug/join',
  requireAuth,
  asyncHandler(async (req, res) => {
    const row = findCommunity(param(req, 'idOrSlug'));
    const user = currentUser(req);

    const existing = queryOne<{ user_id: string }>(
      'SELECT user_id FROM community_members WHERE community_id = ? AND user_id = ?',
      [row.id, user.id],
    );
    if (existing) throw conflict('You are already in that group.');

    execute(
      "INSERT INTO community_members (community_id, user_id, role, joined_at) VALUES (?, ?, 'member', ?)",
      [row.id, user.id, nowIso()],
    );
    res.json({ ok: true, communityId: row.id });
  }),
);

communitiesRouter.post(
  '/:idOrSlug/leave',
  requireAuth,
  asyncHandler(async (req, res) => {
    const row = findCommunity(param(req, 'idOrSlug'));
    const user = currentUser(req);

    // Without this, a group could be left with no one able to run events.
    const organizers = queryOne<{ count: number }>(
      "SELECT COUNT(*) AS count FROM community_members WHERE community_id = ? AND role = 'organizer'",
      [row.id],
    );
    const mine = queryOne<{ role: string }>(
      'SELECT role FROM community_members WHERE community_id = ? AND user_id = ?',
      [row.id, user.id],
    );
    if (mine?.role === 'organizer' && (organizers?.count ?? 0) <= 1) {
      throw conflict('Make someone else an organizer before you leave.');
    }

    execute('DELETE FROM community_members WHERE community_id = ? AND user_id = ?', [
      row.id,
      user.id,
    ]);
    res.json({ ok: true });
  }),
);

// ------------------------------------------------------------------ events

interface EventRow {
  id: string;
  community_id: string;
  title: string;
  description: string;
  starts_at: string;
  ends_at: string | null;
  lat: number | null;
  lon: number | null;
  address_line: string | null;
  created_by: string;
  created_at: string;
  going_count?: number;
  creator_name?: string;
}

const serializeEvent = (row: EventRow, myRsvp: string | null = null) => ({
  id: row.id,
  communityId: row.community_id,
  title: row.title,
  description: row.description,
  startsAt: row.starts_at,
  endsAt: row.ends_at,
  lat: row.lat,
  lon: row.lon,
  addressLine: row.address_line,
  createdBy: row.created_by,
  creatorName: row.creator_name ?? null,
  createdAt: row.created_at,
  goingCount: row.going_count ?? 0,
  myRsvp,
});

const EVENT_SELECT = `
  SELECT e.*,
         u.display_name AS creator_name,
         (SELECT COUNT(*) FROM event_rsvps r WHERE r.event_id = e.id AND r.status = 'going')
           AS going_count
    FROM events e
    JOIN users u ON u.id = e.created_by`;

communitiesRouter.get(
  '/:idOrSlug/events',
  asyncHandler(async (req, res) => {
    const community = findCommunity(param(req, 'idOrSlug'));
    const viewer = req.user ?? null;
    const includePast = req.query.past === '1';

    const rows = query<EventRow>(
      `${EVENT_SELECT}
        WHERE e.community_id = ? ${includePast ? '' : 'AND e.starts_at >= ?'}
        ORDER BY e.starts_at ASC
        LIMIT 100`,
      includePast ? [community.id] : [community.id, nowIso()],
    );

    const myRsvps = viewer
      ? new Map(
          query<{ event_id: string; status: string }>(
            'SELECT event_id, status FROM event_rsvps WHERE user_id = ?',
            [viewer.id],
          ).map((row) => [row.event_id, row.status]),
        )
      : new Map<string, string>();

    res.json({
      events: rows.map((row) => serializeEvent(row, myRsvps.get(row.id) ?? null)),
    });
  }),
);

const createEventSchema = z.object({
  title: cleanText(120, 4),
  description: cleanMultiline(2000).default(''),
  startsAt: z.string().datetime(),
  endsAt: z.string().datetime().nullish(),
  lat: latitude.nullish(),
  lon: longitude.nullish(),
  addressLine: z.string().trim().max(160).nullish(),
});

/** Community scrap drives: a neighbourhood pools its metal for one pickup run. */
communitiesRouter.post(
  '/:idOrSlug/events',
  requireAuth,
  rateLimit({ windowMs: 24 * 60 * 60 * 1000, max: 20, keyPrefix: 'create-event' }),
  asyncHandler(async (req, res) => {
    const input = createEventSchema.parse(req.body);
    const community = findCommunity(param(req, 'idOrSlug'));
    const user = currentUser(req);

    const membership = queryOne<{ role: string }>(
      'SELECT role FROM community_members WHERE community_id = ? AND user_id = ?',
      [community.id, user.id],
    );
    if (!membership) throw forbidden('Join the group before scheduling an event.');

    const id = newId('evt');
    execute(
      `INSERT INTO events (
         id, community_id, title, description, starts_at, ends_at,
         lat, lon, address_line, created_by, created_at
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        id,
        community.id,
        input.title,
        input.description,
        input.startsAt,
        input.endsAt ?? null,
        input.lat ?? null,
        input.lon ?? null,
        input.addressLine ?? null,
        user.id,
        nowIso(),
      ],
    );

    const members = query<{ user_id: string }>(
      'SELECT user_id FROM community_members WHERE community_id = ? AND user_id != ?',
      [community.id, user.id],
    );
    for (const member of members) {
      notify({
        userId: member.user_id,
        type: 'event_created',
        title: `New event in ${community.name}`,
        body: input.title,
        link: `/communities/${community.slug}`,
      });
    }

    const row = queryOne<EventRow>(`${EVENT_SELECT} WHERE e.id = ?`, [id]);
    res.status(201).json({ event: row ? serializeEvent(row) : null });
  }),
);

const rsvpSchema = z.object({ status: z.enum(['going', 'maybe', 'declined']) });

communitiesRouter.post(
  '/events/:eventId/rsvp',
  requireAuth,
  asyncHandler(async (req, res) => {
    const input = rsvpSchema.parse(req.body);
    const user = currentUser(req);

    const event = queryOne<{ id: string }>('SELECT id FROM events WHERE id = ?', [
      param(req, 'eventId'),
    ]);
    if (!event) throw notFound('No such event.');

    execute(
      `INSERT INTO event_rsvps (event_id, user_id, status, created_at)
       VALUES (?, ?, ?, ?)
       ON CONFLICT (event_id, user_id) DO UPDATE SET status = excluded.status`,
      [event.id, user.id, input.status, nowIso()],
    );

    res.json({ ok: true, status: input.status });
  }),
);

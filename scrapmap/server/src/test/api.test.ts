import './setup.ts';

import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';

import { createApp } from '../app.ts';
import { getDb } from '../db/index.ts';
import { distanceMiles, boundingBox, fuzzCoordinate } from '../lib/geo.ts';
import { hashPassword, verifyPassword } from '../lib/password.ts';
import { createSessionToken, verifySessionToken } from '../lib/tokens.ts';
import { findProhibitedItem, MATERIALS, MATERIALS_BY_KEY } from '../data/materials.ts';
import { estimateValue } from '../services/estimate.ts';
import { getPrices } from '../services/prices.ts';

let server: Server;
let baseUrl: string;

before(async () => {
  getDb();
  server = createApp().listen(0);
  await new Promise<void>((resolve) => server.once('listening', resolve));
  baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

after(() => {
  server.close();
});

interface CallOptions {
  token?: string;
  body?: unknown;
  raw?: Buffer;
  contentType?: string;
}

async function call(
  method: string,
  path: string,
  options: CallOptions = {},
): Promise<{ status: number; data: any }> {
  const headers: Record<string, string> = {};
  if (options.token) headers.Authorization = `Bearer ${options.token}`;
  if (options.contentType) headers['Content-Type'] = options.contentType;
  else if (options.body !== undefined) headers['Content-Type'] = 'application/json';

  const response = await fetch(baseUrl + path, {
    method,
    headers,
    body: options.raw ?? (options.body === undefined ? undefined : JSON.stringify(options.body)),
  });

  const text = await response.text();
  let data: unknown = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = text;
  }
  return { status: response.status, data };
}

let counter = 0;
async function makeUser(overrides: Record<string, unknown> = {}) {
  counter += 1;
  const email = `user${counter}-${Date.now()}@example.test`;
  const response = await call('POST', '/api/auth/register', {
    body: {
      email,
      password: 'a-perfectly-fine-password',
      displayName: `Tester ${counter}`,
      homeLat: 39.96,
      homeLon: -82.99,
      ...overrides,
    },
  });
  assert.equal(response.status, 201, JSON.stringify(response.data));
  return { token: response.data.token as string, id: response.data.user.id as string, email };
}

async function makeListing(token: string, overrides: Record<string, unknown> = {}) {
  const response = await call('POST', '/api/listings', {
    token,
    body: {
      title: 'Copper pipe from a remodel',
      lat: 39.97,
      lon: -83.0,
      addressLine: '123 Test St',
      city: 'Columbus',
      materials: [{ materialKey: 'copper-1', weightLbs: 20 }],
      ...overrides,
    },
  });
  assert.equal(response.status, 201, JSON.stringify(response.data));
  return response.data.listing;
}

// --------------------------------------------------------------- pure logic

describe('geo maths', () => {
  it('measures a known distance', () => {
    // Columbus to Cleveland is roughly 125 miles.
    const distance = distanceMiles(39.9612, -82.9988, 41.4993, -81.6944);
    assert.ok(distance > 120 && distance < 132, `got ${distance}`);
  });

  it('returns zero for the same point', () => {
    assert.equal(distanceMiles(39.9, -83, 39.9, -83), 0);
  });

  it('builds a box that contains everything inside the radius', () => {
    const box = boundingBox(39.9612, -82.9988, 25);
    // A point 20 miles due north must fall inside the box.
    const northLat = 39.9612 + 20 / 69;
    assert.ok(northLat <= box.maxLat);
    assert.ok(box.minLat < 39.9612 && box.maxLat > 39.9612);
  });

  it('fuzzes coordinates deterministically but not identically', () => {
    const first = fuzzCoordinate(39.9612, -82.9988, 'listing-a');
    const again = fuzzCoordinate(39.9612, -82.9988, 'listing-a');
    const other = fuzzCoordinate(39.9612, -82.9988, 'listing-b');

    assert.deepEqual(first, again, 'same seed must produce the same point');
    assert.notDeepEqual(first, other, 'different listings must not collide');

    // The offset has to be big enough to hide a house but small enough to stay useful.
    const shift = distanceMiles(39.9612, -82.9988, first.lat, first.lon);
    assert.ok(shift > 0 && shift < 0.2, `shifted ${shift} mi`);
  });
});

describe('password hashing', () => {
  it('verifies a correct password and rejects a wrong one', async () => {
    const hash = await hashPassword('correct horse battery staple');
    assert.ok(hash.startsWith('scrypt$'));
    assert.equal(await verifyPassword('correct horse battery staple', hash), true);
    assert.equal(await verifyPassword('Correct horse battery staple', hash), false);
  });

  it('produces a different hash each time', async () => {
    const a = await hashPassword('same-password-here');
    const b = await hashPassword('same-password-here');
    assert.notEqual(a, b, 'salts must differ');
  });

  it('rejects malformed stored hashes rather than throwing', async () => {
    assert.equal(await verifyPassword('x', 'garbage'), false);
    assert.equal(await verifyPassword('x', 'scrypt$1$2$3'), false);
  });
});

describe('session tokens', () => {
  it('round-trips a valid token', () => {
    const token = createSessionToken('usr_123', 7);
    const payload = verifySessionToken(token);
    assert.equal(payload?.sub, 'usr_123');
    assert.equal(payload?.tv, 7);
  });

  it('rejects a tampered payload', () => {
    const token = createSessionToken('usr_123', 1);
    const [body, signature] = token.split('.');
    const forged = Buffer.from(
      JSON.stringify({ sub: 'usr_evil', iat: 0, exp: 9999999999, tv: 1 }),
    ).toString('base64url');
    assert.equal(verifySessionToken(`${forged}.${signature}`), null);
    assert.ok(body);
  });

  it('rejects garbage', () => {
    assert.equal(verifySessionToken('nonsense'), null);
    assert.equal(verifySessionToken(''), null);
  });
});

describe('material catalog', () => {
  it('has unique keys and sane percentages', () => {
    const keys = new Set(MATERIALS.map((material) => material.key));
    assert.equal(keys.size, MATERIALS.length, 'duplicate material key');

    for (const material of MATERIALS) {
      if (material.basis === 'flat') {
        assert.ok((material.flatPerLb ?? 0) > 0, `${material.key} needs a flat price`);
      } else {
        assert.ok(
          material.yardPct > 0 && material.yardPct <= 1,
          `${material.key} has an implausible yardPct`,
        );
      }
      assert.ok(material.foundIn.length > 0, `${material.key} needs household examples`);
    }
  });

  it('grades copper in the right order', () => {
    const bare = MATERIALS_BY_KEY.get('bare-bright')!;
    const one = MATERIALS_BY_KEY.get('copper-1')!;
    const two = MATERIALS_BY_KEY.get('copper-2')!;
    const romex = MATERIALS_BY_KEY.get('icw-romex')!;
    assert.ok(bare.yardPct > one.yardPct);
    assert.ok(one.yardPct > two.yardPct);
    assert.ok(two.yardPct > romex.yardPct);
  });

  it('flags theft-prone items', () => {
    assert.equal(findProhibitedItem('Catalytic converter off my truck'), 'catalytic converters');
    assert.equal(findProhibitedItem('two beer kegs'), 'beer kegs');
    assert.equal(findProhibitedItem(null, 'a spool of utility wire'), 'utility line');
    assert.equal(findProhibitedItem('Copper pipe and brass fittings'), null);
  });
});

describe('value estimation', () => {
  it('prices a pile off the copper index', async () => {
    const prices = await getPrices();
    const result = estimateValue([{ materialKey: 'copper-1', weightLbs: 100 }], prices);
    const expected = Math.round(prices.copper.usdPerLb * 0.82 * 100 * 100);
    assert.equal(result.totalValueCents, expected);
    assert.equal(result.totalWeightLbs, 100);
  });

  it('sums multiple lines and skips unknown materials', async () => {
    const prices = await getPrices();
    const result = estimateValue(
      [
        { materialKey: 'copper-1', weightLbs: 10 },
        { materialKey: 'yellow-brass', weightLbs: 10 },
        { materialKey: 'not-a-real-material', weightLbs: 500 },
      ],
      prices,
    );
    assert.equal(result.lines.length, 2, 'unknown material should be dropped, not fatal');
    assert.equal(result.totalWeightLbs, 20);
  });

  it('falls back to a baseline price when offline', async () => {
    // OFFLINE_MODE is on for tests, so this exercises the degraded path.
    const prices = await getPrices();
    assert.equal(prices.copper.isLive, false);
    assert.ok(prices.copper.usdPerLb > 1, 'baseline must still be a usable number');
    assert.ok(prices.disclaimer.length > 20);
  });
});

// ------------------------------------------------------------------- routes

describe('auth', () => {
  it('registers, authenticates, and rejects bad credentials', async () => {
    const { email } = await makeUser();

    const good = await call('POST', '/api/auth/login', {
      body: { email, password: 'a-perfectly-fine-password' },
    });
    assert.equal(good.status, 200);
    assert.ok(good.data.token);

    const bad = await call('POST', '/api/auth/login', {
      body: { email, password: 'wrong' },
    });
    assert.equal(bad.status, 401);
  });

  it('refuses a duplicate email', async () => {
    const { email } = await makeUser();
    const duplicate = await call('POST', '/api/auth/register', {
      body: { email, password: 'another-long-password', displayName: 'Copy Cat' },
    });
    assert.equal(duplicate.status, 409);
  });

  it('returns field-level validation errors', async () => {
    const response = await call('POST', '/api/auth/register', {
      body: { email: 'nope', password: 'short', displayName: 'x' },
    });
    assert.equal(response.status, 422);
    assert.ok(response.data.error.fields.email);
    assert.ok(response.data.error.fields.password);
  });

  it('invalidates old tokens after a password change', async () => {
    const user = await makeUser();
    const changed = await call('POST', '/api/auth/change-password', {
      token: user.token,
      body: { currentPassword: 'a-perfectly-fine-password', newPassword: 'a-brand-new-password' },
    });
    assert.equal(changed.status, 200);

    const withOldToken = await call('GET', '/api/auth/me', { token: user.token });
    assert.equal(withOldToken.status, 401, 'the pre-change token must stop working');

    const withNewToken = await call('GET', '/api/auth/me', { token: changed.data.token });
    assert.equal(withNewToken.status, 200);
  });
});

describe('listings', () => {
  it('creates a listing and stores a value snapshot', async () => {
    const owner = await makeUser();
    const listing = await makeListing(owner.token);
    assert.equal(listing.status, 'open');
    assert.ok(listing.estimatedValueCents > 0);
    assert.equal(listing.totalWeightLbs, 20);
  });

  it('blocks prohibited items', async () => {
    const owner = await makeUser();
    const response = await call('POST', '/api/listings', {
      token: owner.token,
      body: {
        title: 'Catalytic converter, low miles',
        lat: 39.97,
        lon: -83.0,
        materials: [{ materialKey: 'mixed-scrap', weightLbs: 10 }],
      },
    });
    assert.equal(response.status, 400);
    assert.equal(response.data.error.details.reason, 'prohibited_item');
  });

  it('rejects a free listing that carries a price', async () => {
    const owner = await makeUser();
    const response = await call('POST', '/api/listings', {
      token: owner.token,
      body: {
        title: 'Contradictory listing',
        lat: 39.97,
        lon: -83.0,
        priceType: 'free',
        priceCents: 500,
        materials: [{ materialKey: 'mixed-scrap', weightLbs: 10 }],
      },
    });
    assert.equal(response.status, 400);
  });

  it('requires authentication to post', async () => {
    const response = await call('POST', '/api/listings', {
      body: { title: 'Anonymous', lat: 1, lon: 1, materials: [] },
    });
    assert.equal(response.status, 401);
  });

  it('hides the exact address from the public and reveals it to the claimant', async () => {
    const owner = await makeUser();
    const scrapper = await makeUser();
    const listing = await makeListing(owner.token);

    const anonymous = await call('GET', `/api/listings/${listing.id}`);
    assert.equal(anonymous.data.listing.approximateLocation, true);
    assert.equal(anonymous.data.listing.addressLine, null);
    assert.equal(anonymous.data.listing.pickupNotes, '');
    assert.notEqual(anonymous.data.listing.lat, listing.lat, 'public latitude must be fuzzed');

    const claim = await call('POST', `/api/listings/${listing.id}/claims`, {
      token: scrapper.token,
      body: { message: 'On my way' },
    });
    assert.equal(claim.status, 201);

    // Still hidden while the claim is only pending.
    const pending = await call('GET', `/api/listings/${listing.id}`, { token: scrapper.token });
    assert.equal(pending.data.listing.approximateLocation, true);

    await call('PATCH', `/api/claims/${claim.data.claim.id}`, {
      token: owner.token,
      body: { action: 'accept' },
    });

    const accepted = await call('GET', `/api/listings/${listing.id}`, { token: scrapper.token });
    assert.equal(accepted.data.listing.approximateLocation, false);
    assert.equal(accepted.data.listing.addressLine, '123 Test St');
  });

  it('filters by radius, material, and category', async () => {
    const owner = await makeUser();
    await makeListing(owner.token, {
      title: 'Bare bright bundle for the radius test',
      lat: 39.97,
      lon: -83.0,
      materials: [{ materialKey: 'bare-bright', weightLbs: 5 }],
    });

    const near = await call('GET', '/api/listings?lat=39.97&lon=-83.0&radiusMiles=5');
    assert.ok(near.data.listings.length > 0);

    const far = await call('GET', '/api/listings?lat=25.76&lon=-80.19&radiusMiles=5');
    assert.equal(far.data.listings.length, 0, 'Miami should not see Columbus scrap');

    const byMaterial = await call('GET', '/api/listings?materialKey=bare-bright');
    assert.ok(byMaterial.data.listings.length > 0);
    assert.ok(
      byMaterial.data.listings.every((listing: any) =>
        listing.materials.some((material: any) => material.materialKey === 'bare-bright'),
      ),
    );

    const byCategory = await call('GET', '/api/listings?category=copper');
    assert.ok(byCategory.data.listings.length > 0);

    const nonsense = await call('GET', '/api/listings?category=unobtanium');
    assert.equal(nonsense.data.listings.length, 0);
  });

  it('only lets the owner edit or delete', async () => {
    const owner = await makeUser();
    const stranger = await makeUser();
    const listing = await makeListing(owner.token);

    const edit = await call('PATCH', `/api/listings/${listing.id}`, {
      token: stranger.token,
      body: { title: 'Hijacked' },
    });
    assert.equal(edit.status, 403);

    const remove = await call('DELETE', `/api/listings/${listing.id}`, { token: stranger.token });
    assert.equal(remove.status, 403);

    const ownEdit = await call('PATCH', `/api/listings/${listing.id}`, {
      token: owner.token,
      body: { title: 'Renamed by the owner' },
    });
    assert.equal(ownEdit.status, 200);
    assert.equal(ownEdit.data.listing.title, 'Renamed by the owner');
  });

  it('re-prices when the material list changes', async () => {
    const owner = await makeUser();
    const listing = await makeListing(owner.token);
    const before = listing.estimatedValueCents;

    const updated = await call('PATCH', `/api/listings/${listing.id}`, {
      token: owner.token,
      body: { materials: [{ materialKey: 'copper-1', weightLbs: 200 }] },
    });
    assert.equal(updated.status, 200);
    assert.ok(updated.data.listing.estimatedValueCents > before * 5);
    assert.equal(updated.data.listing.totalWeightLbs, 200);
  });
});

describe('claim lifecycle', () => {
  it('runs the happy path from claim to completion', async () => {
    const owner = await makeUser();
    const scrapper = await makeUser();
    const listing = await makeListing(owner.token);

    const claim = await call('POST', `/api/listings/${listing.id}/claims`, {
      token: scrapper.token,
      body: { message: 'Tomorrow morning work?' },
    });
    assert.equal(claim.status, 201);
    const claimId = claim.data.claim.id;

    const accepted = await call('PATCH', `/api/claims/${claimId}`, {
      token: owner.token,
      body: { action: 'accept' },
    });
    assert.equal(accepted.data.claim.status, 'accepted');
    assert.equal(accepted.data.claim.listingStatus, 'claimed');

    const completed = await call('PATCH', `/api/claims/${claimId}`, {
      token: owner.token,
      body: { action: 'complete' },
    });
    assert.equal(completed.data.claim.status, 'completed');
    assert.equal(completed.data.claim.listingStatus, 'completed');
  });

  it('declines the other claims when one is accepted', async () => {
    const owner = await makeUser();
    const first = await makeUser();
    const second = await makeUser();
    const listing = await makeListing(owner.token);

    const claimA = await call('POST', `/api/listings/${listing.id}/claims`, { token: first.token });
    const claimB = await call('POST', `/api/listings/${listing.id}/claims`, { token: second.token });

    await call('PATCH', `/api/claims/${claimA.data.claim.id}`, {
      token: owner.token,
      body: { action: 'accept' },
    });

    const claims = await call('GET', `/api/listings/${listing.id}/claims`, { token: owner.token });
    const loser = claims.data.claims.find((claim: any) => claim.id === claimB.data.claim.id);
    assert.equal(loser.status, 'declined');
  });

  it('reopens the listing when the accepted scrapper withdraws', async () => {
    const owner = await makeUser();
    const scrapper = await makeUser();
    const listing = await makeListing(owner.token);

    const claim = await call('POST', `/api/listings/${listing.id}/claims`, {
      token: scrapper.token,
    });
    await call('PATCH', `/api/claims/${claim.data.claim.id}`, {
      token: owner.token,
      body: { action: 'accept' },
    });

    const withdrawn = await call('PATCH', `/api/claims/${claim.data.claim.id}`, {
      token: scrapper.token,
      body: { action: 'withdraw' },
    });
    assert.equal(withdrawn.data.claim.listingStatus, 'open');
    assert.equal(withdrawn.data.claim.status, 'withdrawn');
  });

  it('refuses self-claims, duplicate claims, and cross-user actions', async () => {
    const owner = await makeUser();
    const scrapper = await makeUser();
    const stranger = await makeUser();
    const listing = await makeListing(owner.token);

    const own = await call('POST', `/api/listings/${listing.id}/claims`, { token: owner.token });
    assert.equal(own.status, 400);

    const claim = await call('POST', `/api/listings/${listing.id}/claims`, {
      token: scrapper.token,
    });
    const duplicate = await call('POST', `/api/listings/${listing.id}/claims`, {
      token: scrapper.token,
    });
    assert.equal(duplicate.status, 409);

    const byStranger = await call('PATCH', `/api/claims/${claim.data.claim.id}`, {
      token: stranger.token,
      body: { action: 'accept' },
    });
    assert.equal(byStranger.status, 403);

    const byScrapper = await call('PATCH', `/api/claims/${claim.data.claim.id}`, {
      token: scrapper.token,
      body: { action: 'accept' },
    });
    assert.equal(byScrapper.status, 403, 'a scrapper cannot accept their own claim');
  });
});

describe('messaging', () => {
  it('keeps a thread between the two parties and marks it read', async () => {
    const owner = await makeUser();
    const scrapper = await makeUser();
    const listing = await makeListing(owner.token);

    const sent = await call('POST', `/api/listings/${listing.id}/messages`, {
      token: scrapper.token,
      body: { body: 'Is this still available?' },
    });
    assert.equal(sent.status, 201);

    // The poster has to say who they are replying to.
    const ambiguous = await call('GET', `/api/listings/${listing.id}/messages`, {
      token: owner.token,
    });
    assert.equal(ambiguous.status, 403);

    const thread = await call(
      'GET',
      `/api/listings/${listing.id}/messages?with=${scrapper.id}`,
      { token: owner.token },
    );
    assert.equal(thread.status, 200);
    assert.equal(thread.data.messages.length, 1);

    const inbox = await call('GET', '/api/threads', { token: owner.token });
    assert.equal(inbox.data.threads.length, 1);
    assert.equal(inbox.data.threads[0].unread, 0, 'reading the thread clears the badge');
  });
});

describe('reviews', () => {
  it('only allows a rating after completion, once per side', async () => {
    const owner = await makeUser();
    const scrapper = await makeUser();
    const stranger = await makeUser();
    const listing = await makeListing(owner.token);

    const early = await call('POST', '/api/reviews', {
      token: owner.token,
      body: { listingId: listing.id, rating: 5 },
    });
    assert.equal(early.status, 409);

    const claim = await call('POST', `/api/listings/${listing.id}/claims`, {
      token: scrapper.token,
    });
    await call('PATCH', `/api/claims/${claim.data.claim.id}`, {
      token: owner.token,
      body: { action: 'accept' },
    });
    await call('PATCH', `/api/claims/${claim.data.claim.id}`, {
      token: owner.token,
      body: { action: 'complete' },
    });

    const rated = await call('POST', '/api/reviews', {
      token: owner.token,
      body: { listingId: listing.id, rating: 5, comment: 'Prompt and tidy.' },
    });
    assert.equal(rated.status, 201);

    const again = await call('POST', '/api/reviews', {
      token: owner.token,
      body: { listingId: listing.id, rating: 1 },
    });
    assert.equal(again.status, 409);

    const outsider = await call('POST', '/api/reviews', {
      token: stranger.token,
      body: { listingId: listing.id, rating: 1 },
    });
    assert.equal(outsider.status, 403);

    const profile = await call('GET', `/api/users/${scrapper.id}`);
    assert.equal(profile.data.user.rating, 5);
    assert.equal(profile.data.user.reviewCount, 1);
  });
});

describe('communities', () => {
  it('creates a group, enforces membership, and runs events', async () => {
    const organizer = await makeUser();
    const outsider = await makeUser();

    const created = await call('POST', '/api/communities', {
      token: organizer.token,
      body: { name: 'Test Street Crew', description: 'Testing', lat: 39.96, lon: -82.99 },
    });
    assert.equal(created.status, 201);
    const slug = created.data.community.slug;
    assert.equal(created.data.community.memberCount, 1);

    const eventByOutsider = await call('POST', `/api/communities/${slug}/events`, {
      token: outsider.token,
      body: { title: 'Crashing the party', startsAt: new Date(Date.now() + 86400000).toISOString() },
    });
    assert.equal(eventByOutsider.status, 403);

    const joined = await call('POST', `/api/communities/${slug}/join`, { token: outsider.token });
    assert.equal(joined.status, 200);

    const twice = await call('POST', `/api/communities/${slug}/join`, { token: outsider.token });
    assert.equal(twice.status, 409);

    const event = await call('POST', `/api/communities/${slug}/events`, {
      token: outsider.token,
      body: {
        title: 'Saturday scrap drive',
        startsAt: new Date(Date.now() + 86400000).toISOString(),
      },
    });
    assert.equal(event.status, 201);

    const rsvp = await call('POST', `/api/communities/events/${event.data.event.id}/rsvp`, {
      token: organizer.token,
      body: { status: 'going' },
    });
    assert.equal(rsvp.status, 200);

    const events = await call('GET', `/api/communities/${slug}/events`, { token: organizer.token });
    assert.equal(events.data.events[0].goingCount, 1);
    assert.equal(events.data.events[0].myRsvp, 'going');
  });

  it('stops the last organizer from abandoning a group', async () => {
    const organizer = await makeUser();
    const created = await call('POST', '/api/communities', {
      token: organizer.token,
      body: { name: 'Solo Organizer Group' },
    });
    const leave = await call('POST', `/api/communities/${created.data.community.slug}/leave`, {
      token: organizer.token,
    });
    assert.equal(leave.status, 409);
  });
});

describe('photos', () => {
  // Smallest valid PNG: signature, IHDR, IDAT, IEND.
  const PNG = Buffer.from(
    '89504e470d0a1a0a0000000d4948445200000001000000010806000000' +
      '1f15c4890000000a49444154789c6300010000050001' +
      '0d0a2db40000000049454e44ae426082',
    'hex',
  );

  it('accepts a real image from the owner and rejects everything else', async () => {
    const owner = await makeUser();
    const stranger = await makeUser();
    const listing = await makeListing(owner.token);

    const uploaded = await call('POST', `/api/listings/${listing.id}/photos`, {
      token: owner.token,
      raw: PNG,
      contentType: 'image/png',
    });
    assert.equal(uploaded.status, 201);
    assert.match(uploaded.data.photo.url, /^\/uploads\/[a-f0-9]{32}\.png$/);

    const notAnImage = await call('POST', `/api/listings/${listing.id}/photos`, {
      token: owner.token,
      raw: Buffer.from('<?php echo "hello"; ?>'),
      contentType: 'image/png',
    });
    assert.equal(notAnImage.status, 400, 'content-type must be backed by real magic bytes');

    const byStranger = await call('POST', `/api/listings/${listing.id}/photos`, {
      token: stranger.token,
      raw: PNG,
      contentType: 'image/png',
    });
    assert.equal(byStranger.status, 403);
  });
});

describe('third-party degradation', () => {
  it('serves reference data without any network access', async () => {
    const materials = await call('GET', '/api/materials');
    assert.equal(materials.status, 200);
    assert.ok(materials.data.materials.length > 20);
    assert.ok(materials.data.prohibitedItems.includes('catalytic converters'));
    assert.equal(materials.data.prices.freshness, 'fallback');
  });

  it('returns 503 rather than crashing when geocoding is unreachable', async () => {
    const response = await call('GET', '/api/geo/search?q=Columbus%20Ohio');
    assert.equal(response.status, 503);
    assert.equal(response.data.error.code, 'upstream_unavailable');
  });

  it('reports stats even with no completed pickups in view', async () => {
    const stats = await call('GET', '/api/stats');
    assert.equal(stats.status, 200);
    assert.ok(typeof stats.data.totals.poundsDiverted === 'number');
    assert.ok(Array.isArray(stats.data.leaderboard.scrappers));
  });
});

describe('rate limiting', () => {
  /**
   * Limits are switched off for the suite (every request comes from 127.0.0.1),
   * so the middleware is exercised directly against a throwaway app.
   */
  it('allows up to the cap then returns 429 with Retry-After', async () => {
    const { default: express } = await import('express');
    const { rateLimit } = await import('../middleware/rateLimit.ts');
    const { errorHandler } = await import('../middleware/error.ts');
    const { env } = await import('../env.ts');

    const app = express();
    app.get('/limited', rateLimit({ windowMs: 60_000, max: 2, keyPrefix: 'unit' }), (_req, res) => {
      res.json({ ok: true });
    });
    app.use(errorHandler);

    const listener = app.listen(0);
    await new Promise<void>((resolve) => listener.once('listening', resolve));
    const port = (listener.address() as AddressInfo).port;

    // Flip the switch on just for this check, then restore it.
    const original = env.rateLimitEnabled;
    (env as { rateLimitEnabled: boolean }).rateLimitEnabled = true;

    try {
      const first = await fetch(`http://127.0.0.1:${port}/limited`);
      const second = await fetch(`http://127.0.0.1:${port}/limited`);
      const third = await fetch(`http://127.0.0.1:${port}/limited`);

      assert.equal(first.status, 200);
      assert.equal(second.status, 200);
      assert.equal(third.status, 429);
      assert.ok(third.headers.get('retry-after'), 'a 429 must say when to retry');
    } finally {
      (env as { rateLimitEnabled: boolean }).rateLimitEnabled = original;
      listener.close();
    }
  });
});

describe('misc', () => {
  it('reports health', async () => {
    const response = await call('GET', '/api/health');
    assert.equal(response.status, 200);
    assert.equal(response.data.ok, true);
  });

  it('404s an unknown route as JSON', async () => {
    const response = await call('GET', '/api/nope');
    assert.equal(response.status, 404);
    assert.equal(response.data.error.code, 'not_found');
  });
});

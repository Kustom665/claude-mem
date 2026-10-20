/**
 * Demo data so a fresh clone opens onto a populated map instead of an empty one.
 *
 * Run with `npm run seed`. Pass --fresh to wipe existing rows first.
 */
import { execute, getDb, nowIso, queryOne, transaction } from './index.ts';
import { ensureDirectories } from '../env.ts';
import { newId, slugify } from '../lib/ids.ts';
import { hashPassword } from '../lib/password.ts';
import { estimateValue } from '../services/estimate.ts';
import { getPrices } from '../services/prices.ts';

const DEMO_PASSWORD = 'scrapmap-demo-2026';

/** Centred on Columbus, Ohio, with listings scattered across the metro. */
const CENTER = { lat: 39.9612, lon: -82.9988 };

const offset = (dLat: number, dLon: number) => ({
  lat: Number((CENTER.lat + dLat).toFixed(6)),
  lon: Number((CENTER.lon + dLon).toFixed(6)),
});

const daysFromNow = (days: number): string =>
  new Date(Date.now() + days * 24 * 60 * 60 * 1000).toISOString();

const daysAgo = (days: number): string => daysFromNow(-days);

interface SeedUser {
  key: string;
  email: string;
  displayName: string;
  role: 'homeowner' | 'scrapper' | 'both';
  bio: string;
  point: { lat: number; lon: number };
  city: string;
  radius: number;
}

const USERS: SeedUser[] = [
  {
    key: 'dana',
    email: 'dana@example.com',
    displayName: 'Dana R.',
    role: 'homeowner',
    bio: 'Rehabbing a 1940s bungalow in Clintonville. Constantly pulling out old plumbing and wire.',
    point: offset(0.038, 0.006),
    city: 'Columbus',
    radius: 15,
  },
  {
    key: 'marcus',
    email: 'marcus@example.com',
    displayName: 'Marcus T.',
    role: 'scrapper',
    bio: 'Full-time scrapper with a dump trailer. I sort on site and I show up when I say I will.',
    point: offset(-0.02, 0.03),
    city: 'Columbus',
    radius: 35,
  },
  {
    key: 'priya',
    email: 'priya@example.com',
    displayName: 'Priya S.',
    role: 'both',
    bio: 'Property manager for a handful of rentals. Happy to hand off metal instead of paying for a dumpster.',
    point: offset(0.012, -0.045),
    city: 'Grandview Heights',
    radius: 20,
  },
  {
    key: 'walt',
    email: 'walt@example.com',
    displayName: 'Walt K.',
    role: 'scrapper',
    bio: 'Retired HVAC tech. I take sealed units and coils, and I pump refrigerant properly first.',
    point: offset(-0.055, -0.01),
    city: 'Columbus',
    radius: 40,
  },
  {
    key: 'joanne',
    email: 'joanne@example.com',
    displayName: 'Joanne M.',
    role: 'homeowner',
    bio: 'Cleaning out my late father’s garage. Forty years of tools, wire, and mystery boxes.',
    point: offset(0.06, 0.055),
    city: 'Westerville',
    radius: 10,
  },
  {
    key: 'tre',
    email: 'tre@example.com',
    displayName: 'Tré W.',
    role: 'scrapper',
    bio: 'Weekend hauler. Small truck, so I take wire, brass, and anything two people can lift.',
    point: offset(0.005, 0.02),
    city: 'Columbus',
    radius: 25,
  },
  {
    key: 'linda',
    email: 'linda@example.com',
    displayName: 'Linda O.',
    role: 'both',
    bio: 'Organizer for our neighborhood cleanup crew. We pool scrap twice a year.',
    point: offset(-0.04, 0.062),
    city: 'Bexley',
    radius: 15,
  },
  {
    key: 'sam',
    email: 'sam@example.com',
    displayName: 'Sam D.',
    role: 'homeowner',
    bio: 'Electrician. I end up with offcut wire on every job and would rather it go to someone local.',
    point: offset(0.028, -0.07),
    city: 'Upper Arlington',
    radius: 20,
  },
];

interface SeedListing {
  key: string;
  owner: string;
  title: string;
  description: string;
  point: { lat: number; lon: number };
  city: string;
  addressLine: string;
  materials: { materialKey: string; weightLbs: number; quantity?: number; notes?: string }[];
  priceType?: 'free' | 'obo' | 'firm';
  priceCents?: number;
  curbside?: boolean;
  helpNeeded?: boolean;
  pickupNotes?: string;
  status?: 'open' | 'claimed' | 'completed';
  claimedBy?: string;
  ageDays: number;
  community?: string;
}

const LISTINGS: SeedListing[] = [
  {
    key: 'repipe',
    owner: 'dana',
    title: 'Whole-house copper repipe — about 140 ft of 1/2" and 3/4"',
    description:
      'Plumber just finished repiping the house in PEX. All the old copper is stacked in the driveway.\n\nMost of it is clean, some has soldered joints still on the ends. There are also a dozen or so brass fittings and two shut-off valves in a bucket.',
    point: offset(0.038, 0.006),
    city: 'Columbus',
    addressLine: '2841 Indianola Ave',
    materials: [
      { materialKey: 'copper-1', weightLbs: 38, notes: 'Clean straight runs' },
      { materialKey: 'copper-2', weightLbs: 22, notes: 'Soldered ends still attached' },
      { materialKey: 'yellow-brass', weightLbs: 9, notes: 'Fittings and two valves' },
    ],
    curbside: true,
    pickupNotes: 'Stacked on the left side of the driveway. Take it any time, no need to knock.',
    ageDays: 1,
  },
  {
    key: 'romex',
    owner: 'sam',
    title: 'Romex offcuts — three buckets of 12-2 and 14-2',
    description:
      'Leftover cable from a panel upgrade and a basement finish. Nothing shorter than about 18 inches, so it strips fine.\n\nAlso a coil of THHN from a conduit run.',
    point: offset(0.028, -0.07),
    city: 'Upper Arlington',
    addressLine: '1720 Zollinger Rd',
    materials: [
      { materialKey: 'icw-romex', weightLbs: 64 },
      { materialKey: 'icw-1-thhn', weightLbs: 18, notes: 'Green and black, 10 gauge' },
    ],
    priceType: 'obo',
    priceCents: 4000,
    pickupNotes: 'Text before coming. Garage bay on the right.',
    ageDays: 2,
  },
  {
    key: 'ac-units',
    owner: 'priya',
    title: 'Two window AC units + a condenser coil',
    description:
      'Pulled these from a rental turnover. Both units are dead. Refrigerant has NOT been recovered on the condenser, so it needs someone certified.',
    point: offset(0.012, -0.045),
    city: 'Grandview Heights',
    addressLine: '1099 W 1st Ave',
    materials: [
      { materialKey: 'sealed-unit', weightLbs: 95 },
      { materialKey: 'clean-copper-alum-radiator', weightLbs: 26 },
    ],
    helpNeeded: true,
    pickupNotes: 'Behind the building by the dumpster corral. Heavy — bring a hand truck.',
    status: 'claimed',
    claimedBy: 'walt',
    ageDays: 4,
  },
  {
    key: 'garage-cleanout',
    owner: 'joanne',
    title: 'Garage cleanout — 40 years of tools, wire, and scrap',
    description:
      'My father passed in the spring and I am clearing his garage. There is a lot in here and I honestly cannot identify most of it.\n\nThere are motors, coils of wire, boxes of fittings, an old radiator, and a lot of steel shelving. I would rather one person take the whole lot than have ten people pick through it.',
    point: offset(0.06, 0.055),
    city: 'Westerville',
    addressLine: '388 S State St',
    materials: [
      { materialKey: 'mixed-scrap', weightLbs: 320 },
      { materialKey: 'electric-motor', weightLbs: 85, quantity: 4 },
      { materialKey: 'copper-brass-heater-core', weightLbs: 18 },
      { materialKey: 'shred-steel', weightLbs: 240, notes: 'Shelving and a workbench frame' },
    ],
    helpNeeded: true,
    pickupNotes: 'Weekends only please. I will be there to let you in.',
    ageDays: 6,
  },
  {
    key: 'gutters',
    owner: 'linda',
    title: 'Copper gutters and downspouts off a porch roof',
    description:
      'Replaced the porch roof and the original copper gutters came down with it. Weathered green but solid. Nails are still in some sections.',
    point: offset(-0.04, 0.062),
    city: 'Bexley',
    addressLine: '2416 E Main St',
    materials: [{ materialKey: 'copper-3-roofing', weightLbs: 52 }],
    priceType: 'firm',
    priceCents: 9000,
    ageDays: 3,
    community: 'bexley-cleanup-crew',
  },
  {
    key: 'water-heater',
    owner: 'dana',
    title: 'Old 40 gallon water heater, drained',
    description: 'Replaced last week. Fully drained, sitting on the back patio. Heavy but rolls fine on a dolly.',
    point: offset(0.0385, 0.0062),
    city: 'Columbus',
    addressLine: '2841 Indianola Ave',
    materials: [{ materialKey: 'appliance-steel', weightLbs: 118 }],
    curbside: true,
    ageDays: 8,
    status: 'completed',
    claimedBy: 'tre',
  },
  {
    key: 'faucets',
    owner: 'priya',
    title: 'Box of brass faucets and valves from a bathroom gut',
    description: 'Six faucets, a pile of angle stops, and some chrome-plated brass trim. All brass underneath.',
    point: offset(0.0125, -0.0455),
    city: 'Grandview Heights',
    addressLine: '1099 W 1st Ave',
    materials: [{ materialKey: 'yellow-brass', weightLbs: 21 }],
    curbside: true,
    pickupNotes: 'In a milk crate by the side door.',
    ageDays: 5,
  },
  {
    key: 'storm-windows',
    owner: 'joanne',
    title: 'Aluminum storm windows — 11 of them',
    description: 'Came off the house when we put in vinyl replacements. Glass still in most of them.',
    point: offset(0.0605, 0.0555),
    city: 'Westerville',
    addressLine: '388 S State St',
    materials: [{ materialKey: 'aluminum-extrusion', weightLbs: 74 }],
    ageDays: 11,
  },
  {
    key: 'extension-cords',
    owner: 'sam',
    title: 'Bin of dead extension cords and appliance leads',
    description: 'Cleaned out the shop. All of these are cut, damaged, or just too short to bother with.',
    point: offset(0.0285, -0.0705),
    city: 'Upper Arlington',
    addressLine: '1720 Zollinger Rd',
    materials: [{ materialKey: 'icw-extension-cord', weightLbs: 27 }],
    curbside: true,
    ageDays: 9,
  },
  {
    key: 'dryer',
    owner: 'linda',
    title: 'Dead clothes dryer + washer motor',
    description: 'Dryer stopped heating and it is not worth fixing. Also have a washer motor I pulled last year.',
    point: offset(-0.0405, 0.0625),
    city: 'Bexley',
    addressLine: '2416 E Main St',
    materials: [
      { materialKey: 'appliance-steel', weightLbs: 108 },
      { materialKey: 'electric-motor', weightLbs: 22 },
    ],
    helpNeeded: true,
    ageDays: 14,
    status: 'completed',
    claimedBy: 'marcus',
    community: 'bexley-cleanup-crew',
  },
  {
    key: 'cat5',
    owner: 'priya',
    title: 'Several hundred feet of Cat5 pulled from an office unit',
    description: 'Tenant left. Ripped all the data cable out of the drop ceiling. Coiled into two contractor bags.',
    point: offset(0.013, -0.046),
    city: 'Grandview Heights',
    addressLine: '1099 W 1st Ave',
    materials: [{ materialKey: 'icw-data-cable', weightLbs: 43 }],
    ageDays: 7,
  },
  {
    key: 'bare-bright',
    owner: 'sam',
    title: 'Bare bright — already stripped, about 30 lbs',
    description:
      'I strip everything heavier than 10 gauge as I go. This is clean bare bright, no insulation, no tarnish. Selling rather than giving since it is prepped.',
    point: offset(0.029, -0.0695),
    city: 'Upper Arlington',
    addressLine: '1720 Zollinger Rd',
    materials: [{ materialKey: 'bare-bright', weightLbs: 31 }],
    priceType: 'firm',
    priceCents: 9500,
    ageDays: 1,
  },
  {
    key: 'cans',
    owner: 'linda',
    title: 'Block party aluminum cans — about 6 bags',
    description: 'Collected from our street festival. Rinsed and bagged. Great for someone who wants volume.',
    point: offset(-0.0415, 0.0615),
    city: 'Bexley',
    addressLine: '2416 E Main St',
    materials: [{ materialKey: 'aluminum-cans', weightLbs: 34 }],
    curbside: true,
    ageDays: 2,
    community: 'bexley-cleanup-crew',
  },
  {
    key: 'sink',
    owner: 'dana',
    title: 'Stainless kitchen sink + a bit of copper tube',
    description: 'Double basin stainless, non-magnetic so it should be 304. Plus a few feet of copper off the trap.',
    point: offset(0.0378, 0.0058),
    city: 'Columbus',
    addressLine: '2841 Indianola Ave',
    materials: [
      { materialKey: 'stainless-304', weightLbs: 19 },
      { materialKey: 'copper-2', weightLbs: 4 },
    ],
    curbside: true,
    ageDays: 4,
  },
  {
    key: 'transformers',
    owner: 'joanne',
    title: 'Microwave transformers and old ballasts',
    description: 'Found a box of these in the garage. Heavy little things. Some ballasts are pretty old.',
    point: offset(0.0598, 0.0548),
    city: 'Westerville',
    addressLine: '388 S State St',
    materials: [{ materialKey: 'copper-transformer', weightLbs: 46 }],
    ageDays: 12,
  },
];

interface SeedCommunity {
  slug: string;
  name: string;
  description: string;
  owner: string;
  members: string[];
  point: { lat: number; lon: number };
  city: string;
}

const COMMUNITIES: SeedCommunity[] = [
  {
    slug: 'bexley-cleanup-crew',
    name: 'Bexley Cleanup Crew',
    description:
      'Neighbors on the east side who pool scrap metal twice a year. We stage everything in one driveway and a local scrapper does a single run.\n\nEveryone is welcome — post what you have, or sign up to haul.',
    owner: 'linda',
    members: ['linda', 'marcus', 'tre', 'joanne'],
    point: offset(-0.04, 0.062),
    city: 'Bexley',
  },
  {
    slug: 'clintonville-renovators',
    name: 'Clintonville Renovators',
    description:
      'Old houses, constant projects, endless copper. Share what is coming out of your walls before it hits a dumpster.',
    owner: 'dana',
    members: ['dana', 'sam', 'tre'],
    point: offset(0.038, 0.006),
    city: 'Columbus',
  },
  {
    slug: 'central-ohio-scrappers',
    name: 'Central Ohio Scrappers',
    description:
      'For the people doing the hauling. Yard price talk, which places buy from the public, and coordinating on big cleanouts nobody wants to take alone.',
    owner: 'marcus',
    members: ['marcus', 'walt', 'tre', 'priya'],
    point: CENTER,
    city: 'Columbus',
  },
];

async function seed(fresh: boolean): Promise<void> {
  ensureDirectories();
  getDb();

  if (fresh) {
    console.log('Clearing existing data...');
    // Order matters only where ON DELETE CASCADE is absent.
    for (const table of [
      'event_rsvps',
      'events',
      'community_members',
      'communities',
      'reviews',
      'messages',
      'claims',
      'listing_photos',
      'listing_materials',
      'listings',
      'notifications',
      'users',
      'api_cache',
    ]) {
      execute(`DELETE FROM ${table}`);
    }
  }

  const existing = queryOne<{ count: number }>('SELECT COUNT(*) AS count FROM users');
  if ((existing?.count ?? 0) > 0 && !fresh) {
    console.log('Database already has users. Re-run with --fresh to reset.');
    return;
  }

  const prices = await getPrices();
  console.log(
    `Pricing against copper at $${prices.copper.usdPerLb.toFixed(2)}/lb (${prices.copper.source}).`,
  );

  const passwordHash = await hashPassword(DEMO_PASSWORD);
  const userIds = new Map<string, string>();
  const now = nowIso();

  transaction(() => {
    for (const user of USERS) {
      const id = newId('usr');
      userIds.set(user.key, id);
      execute(
        `INSERT INTO users (
           id, email, password_hash, display_name, role, bio,
           home_lat, home_lon, city, region, search_radius_miles, created_at, updated_at
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'OH', ?, ?, ?)`,
        [
          id,
          user.email,
          passwordHash,
          user.displayName,
          user.role,
          user.bio,
          user.point.lat,
          user.point.lon,
          user.city,
          user.radius,
          daysAgo(90),
          now,
        ],
      );
    }

    const communityIds = new Map<string, string>();
    for (const community of COMMUNITIES) {
      const id = newId('cmy');
      communityIds.set(community.slug, id);
      execute(
        `INSERT INTO communities (
           id, slug, name, description, city, region, lat, lon, radius_miles, created_by, created_at
         ) VALUES (?, ?, ?, ?, ?, 'OH', ?, ?, 15, ?, ?)`,
        [
          id,
          slugify(community.slug),
          community.name,
          community.description,
          community.city,
          community.point.lat,
          community.point.lon,
          userIds.get(community.owner),
          daysAgo(60),
        ],
      );
      for (const memberKey of community.members) {
        execute(
          `INSERT INTO community_members (community_id, user_id, role, joined_at)
           VALUES (?, ?, ?, ?)`,
          [
            id,
            userIds.get(memberKey),
            memberKey === community.owner ? 'organizer' : 'member',
            daysAgo(55),
          ],
        );
      }
    }

    const listingIds = new Map<string, string>();
    for (const listing of LISTINGS) {
      const id = newId('lst');
      listingIds.set(listing.key, id);
      const estimate = estimateValue(listing.materials, prices);
      const createdAt = daysAgo(listing.ageDays);
      const status = listing.status ?? 'open';

      execute(
        `INSERT INTO listings (
           id, user_id, title, description, status, price_type, price_cents,
           lat, lon, address_line, city, region, pickup_notes,
           curbside, help_needed, estimated_value_cents, total_weight_lbs,
           view_count, community_id, claimed_by, created_at, updated_at, expires_at, completed_at
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'OH', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          id,
          userIds.get(listing.owner),
          listing.title,
          listing.description,
          status,
          listing.priceType ?? 'free',
          listing.priceCents ?? 0,
          listing.point.lat,
          listing.point.lon,
          listing.addressLine,
          listing.city,
          listing.pickupNotes ?? '',
          listing.curbside ? 1 : 0,
          listing.helpNeeded ? 1 : 0,
          estimate.totalValueCents,
          estimate.totalWeightLbs,
          Math.floor(Math.random() * 60) + 3,
          listing.community ? (communityIds.get(listing.community) ?? null) : null,
          listing.claimedBy ? (userIds.get(listing.claimedBy) ?? null) : null,
          createdAt,
          createdAt,
          daysFromNow(30 - listing.ageDays),
          status === 'completed' ? daysAgo(Math.max(0, listing.ageDays - 2)) : null,
        ],
      );

      for (const line of listing.materials) {
        execute(
          `INSERT INTO listing_materials (id, listing_id, material_key, weight_lbs, quantity, notes)
           VALUES (?, ?, ?, ?, ?, ?)`,
          [
            newId('mat'),
            id,
            line.materialKey,
            line.weightLbs,
            line.quantity ?? 1,
            line.notes ?? '',
          ],
        );
      }

      if (listing.claimedBy) {
        execute(
          `INSERT INTO claims (id, listing_id, scrapper_id, status, message, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?)`,
          [
            newId('clm'),
            id,
            userIds.get(listing.claimedBy),
            status === 'completed' ? 'completed' : 'accepted',
            'I can swing by this week — I have a trailer and can take all of it.',
            createdAt,
            createdAt,
          ],
        );
      }
    }

    // A couple of conversations so the inbox is not empty.
    const conversations: [string, string, string, string][] = [
      ['garage-cleanout', 'marcus', 'joanne', 'Happy to take the whole lot. Would Saturday morning work?'],
      ['garage-cleanout', 'joanne', 'marcus', 'Saturday is perfect. I will be there from 9 onward.'],
      ['repipe', 'tre', 'dana', 'On my way over now, should be about 20 minutes out.'],
    ];
    for (const [listingKey, fromKey, toKey, body] of conversations) {
      execute(
        `INSERT INTO messages (id, listing_id, sender_id, recipient_id, body, created_at)
         VALUES (?, ?, ?, ?, ?, ?)`,
        [
          newId('msg'),
          listingIds.get(listingKey),
          userIds.get(fromKey),
          userIds.get(toKey),
          body,
          daysAgo(1),
        ],
      );
    }

    // Reviews on the two completed pickups, so reputation scores are non-empty.
    const reviews: [string, string, string, number, string][] = [
      ['water-heater', 'dana', 'tre', 5, 'Showed up exactly when he said, took it, left the patio clean.'],
      ['water-heater', 'tre', 'dana', 5, 'Easy pickup, everything was where she said it would be.'],
      ['dryer', 'linda', 'marcus', 5, 'Marcus brought a second person for the dryer. Very professional.'],
      ['dryer', 'marcus', 'linda', 4, 'Good communication. Driveway was a little tight for the trailer.'],
    ];
    for (const [listingKey, raterKey, rateeKey, rating, comment] of reviews) {
      execute(
        `INSERT INTO reviews (id, listing_id, rater_id, ratee_id, rating, comment, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
        [
          newId('rev'),
          listingIds.get(listingKey),
          userIds.get(raterKey),
          userIds.get(rateeKey),
          rating,
          comment,
          daysAgo(3),
        ],
      );
    }

    // Upcoming community events.
    const bexley = communityIds.get('bexley-cleanup-crew');
    const scrappers = communityIds.get('central-ohio-scrappers');
    if (bexley) {
      execute(
        `INSERT INTO events (id, community_id, title, description, starts_at, ends_at,
                             lat, lon, address_line, created_by, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          newId('evt'),
          bexley,
          'Spring Scrap Drive — stage it in my driveway',
          'Bring anything metal to 2416 E Main between 9 and 2. We sort into copper, aluminum, and steel piles, then Marcus does one trailer run and splits the proceeds back into the block party fund.',
          daysFromNow(12),
          daysFromNow(12.2),
          CENTER.lat - 0.04,
          CENTER.lon + 0.062,
          '2416 E Main St, Bexley',
          userIds.get('linda'),
          now,
        ],
      );
    }
    if (scrappers) {
      execute(
        `INSERT INTO events (id, community_id, title, description, starts_at, ends_at,
                             lat, lon, address_line, created_by, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          newId('evt'),
          scrappers,
          'Coffee and yard prices — monthly meetup',
          'Informal. We compare what each yard is actually paying this month and who is worth the drive.',
          daysFromNow(5),
          daysFromNow(5.1),
          CENTER.lat,
          CENTER.lon,
          'Downtown Columbus',
          userIds.get('marcus'),
          now,
        ],
      );
    }
  });

  const counts = queryOne<{ users: number; listings: number; communities: number }>(
    `SELECT (SELECT COUNT(*) FROM users) AS users,
            (SELECT COUNT(*) FROM listings) AS listings,
            (SELECT COUNT(*) FROM communities) AS communities`,
  );

  console.log('\nSeeded ScrapMap:');
  console.log(`  ${counts?.users ?? 0} members`);
  console.log(`  ${counts?.listings ?? 0} listings`);
  console.log(`  ${counts?.communities ?? 0} communities`);
  console.log('\nSign in with any of these:');
  for (const user of USERS) {
    console.log(`  ${user.email.padEnd(22)} ${user.role.padEnd(10)} ${user.displayName}`);
  }
  console.log(`\nPassword for all demo accounts: ${DEMO_PASSWORD}\n`);
}

await seed(process.argv.includes('--fresh'));

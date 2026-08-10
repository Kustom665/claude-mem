# ScrapMap

A marketplace and community board for scrap metal. Homeowners post the copper,
brass, and appliances piling up in the garage; local scrappers see it on a map,
claim it, and haul it away — usually for free, usually within a day or two.

Full stack, front to back, running entirely on **free, keyless APIs**. There is
no API key to obtain anywhere in this project.

---

## Quick start

```bash
cd scrapmap
npm install
npm run seed        # demo accounts, listings, and neighborhood groups
npm run dev         # API on :4000, web app on :5173
```

Open <http://localhost:5173> and sign in with any demo account:

| Email                | Role      |
| -------------------- | --------- |
| `dana@example.com`   | homeowner |
| `marcus@example.com` | scrapper  |
| `priya@example.com`  | both      |

Password for all of them: `scrapmap-demo-2026`

Requires Node 22.5+ (for the built-in `node:sqlite` module). No database server,
no native compilation, no Docker.

---

## What it does

**For homeowners**

- Post a pile in three steps: what it is, where it is, when it can be picked up.
- See what it is worth before posting. Weights are matched against live copper
  pricing and typical scrap-yard grade percentages.
- Choose who comes. Scrappers request a pickup; you see their rating and
  completed-pickup count before accepting.
- Your street address stays private until you accept someone. Everyone else
  sees a pin fuzzed to roughly a block.

**For scrappers**

- Browse a live map, filtered by distance, material, category, price, or
  "curbside" (grab it without contacting anyone).
- Get notified automatically when something is posted inside your radius.
- Sort by estimated value or weight so a drive is worth the fuel.
- Find scrap yards nearby, with hours, phone, and directions.
- Check the haul forecast before committing to an open-trailer run.

**For neighborhoods**

- Groups with shared listings, member lists, and scheduled scrap drives.
- Impact tracking: pounds diverted from landfill, by material, with
  leaderboards for both haulers and posters.

**Guardrails**

- Items commonly tied to metal theft — catalytic converters, manhole covers,
  utility line, grave markers, beer kegs — are blocked at post time.
- Ratings are only possible between the two people who actually completed a
  pickup together, once per side.

---

## The free APIs

Every external data source is public, free, and needs no account.

| What                    | Source                             | Used for                                              |
| ----------------------- | ---------------------------------- | ----------------------------------------------------- |
| Copper & aluminum prices | [Stooq](https://stooq.com) CSV quotes | Live COMEX copper (`HG.F`) in USD/lb, the basis for every value estimate |
| Geocoding               | [Nominatim](https://nominatim.openstreetmap.org) | Address autocomplete and reverse lookup                |
| Map tiles               | [OpenStreetMap](https://www.openstreetmap.org)   | Every map in the app, via Leaflet                      |
| Scrap yards             | [Overpass API](https://overpass-api.de)          | Yards and metal recyclers from OpenStreetMap data      |
| Weather                 | [Open-Meteo](https://open-meteo.com)             | Pickup-day forecast and haul scoring                   |

Check whether this machine can reach all of them:

```bash
npm run check:apis
```

### Being a good citizen

These are volunteer-funded services, so the server treats them accordingly:

- **Everything is proxied through the API**, never called from the browser.
  One shared cache serves all visitors instead of one cache per person.
- **Responses are cached in SQLite** with per-source TTLs: 30 minutes for
  prices and weather, 7 days for address searches, 30 days for reverse
  geocoding, 24 hours for scrap yards. The cache survives restarts, so a
  redeploy does not send a burst of traffic upstream.
- **Nominatim is throttled to one request per second** and address
  autocomplete debounces for 600 ms, per its usage policy.
- **A descriptive `User-Agent`** identifies the app on every request. Set your
  own contact address in `OSM_USER_AGENT` before running this anywhere public.

### When they are down

Nothing hard-fails. Prices fall back to the last cached value, then to built-in
baselines, and the UI labels the difference. Yards, weather, and geocoding
degrade to an explanatory message; the map switches to "drop a pin" and posting
still works. `OFFLINE_MODE=1` disables outbound calls entirely for offline
development and CI.

---

## Pricing model

Scrap yards do not publish per-grade APIs, but they price almost everything as a
percentage of the COMEX copper settlement, discounted for contamination and
processing. ScrapMap models that directly: one live feed keeps roughly 25 grades
current.

```
estimated $/lb  =  copper index $/lb  ×  grade percentage
```

Bare bright sits at ~88% of the index, #1 copper at 82%, #2 at 75%, Romex at
40%, sealed AC units at 11%. Aluminum and steel grades work the same way off
their own basis metals. Stainless, lead, and batteries carry flat estimates.

The catalog lives in [`server/src/data/materials.ts`](server/src/data/materials.ts)
and carries more than a price for each grade: what it is, which household items
it comes from, whether a magnet sticks to it, and what prep moves it up a grade.
That is what makes the app usable by somebody who has never scrapped before.

**These are estimates, and the app says so everywhere it shows one.** Real
payouts vary by yard, region, volume, and day.

---

## Architecture

```
scrapmap/
├── server/                      Node 22 + Express 5 + TypeScript, SQLite
│   ├── src/
│   │   ├── app.ts               Express app assembly
│   │   ├── index.ts             Entry point, graceful shutdown, maintenance sweep
│   │   ├── data/materials.ts    Scrap grade catalog and prohibited items
│   │   ├── db/                  Schema, connection, TTL cache, seed data
│   │   ├── lib/                 Geo maths, scrypt hashing, HMAC tokens, HTTP client
│   │   ├── middleware/          Auth, error mapping, rate limiting
│   │   ├── routes/              REST endpoints
│   │   ├── scripts/             Live API connectivity checker
│   │   ├── services/            Free-API integrations and value estimation
│   │   └── test/                Test suite (node:test)
│   └── data/                    SQLite database and uploads (gitignored)
└── web/                         Vite + React 19 + TypeScript + Tailwind 4 + Leaflet
    └── src/
        ├── api/                 Typed API client
        ├── components/          Map, listing card, address search, layout
        ├── pages/               Browse, listing, post wizard, dashboard, groups…
        └── state/               Auth context
```

**Why SQLite via `node:sqlite`.** Node 22 ships SQLite in core, so there is no
database server to run and no native module to compile. A neighborhood-scale
marketplace is a single-writer workload; this is the right size of tool, and it
makes `git clone && npm install && npm run dev` actually work.

**Deliberately dependency-light.** The server has three runtime dependencies:
Express, CORS, and Zod. Password hashing is `node:crypto` scrypt, sessions are
HMAC-signed tokens, rate limiting is a small in-memory token bucket, and photo
uploads are raw image bodies validated by magic bytes rather than a multipart
parser. Less to audit, less to keep patched.

### Security notes

- Passwords: scrypt (N=16384, r=8, p=1) with a per-user salt.
- Sessions: HMAC-SHA256 signed tokens with a `token_version` claim, so changing
  a password invalidates every existing session.
- Exact coordinates and pickup notes are withheld from API responses until a
  pickup is accepted; public coordinates are deterministically fuzzed.
- Uploads are checked against JPEG/PNG/WebP magic bytes, stored under random
  filenames, and served with `X-Content-Type-Options: nosniff` and a restrictive
  CSP.
- Rate limits on registration, login, posting, claiming, messaging, and every
  third-party proxy route.

---

## API

All routes are under `/api`. Authenticate with `Authorization: Bearer <token>`
or the `scrapmap_session` cookie.

| Method   | Path                              | Purpose                                  |
| -------- | --------------------------------- | ---------------------------------------- |
| `POST`   | `/auth/register`, `/auth/login`   | Create a session                         |
| `GET`    | `/auth/me`                        | Current user                             |
| `PATCH`  | `/users/me`                       | Update profile, home base, alert radius  |
| `GET`    | `/listings`                       | Browse with radius, filters, sorting     |
| `POST`   | `/listings`                       | Post scrap (returns a value estimate)    |
| `GET`    | `/listings/:id`                   | Detail, with location gated by role      |
| `POST`   | `/listings/:id/claims`            | Offer to pick it up                      |
| `PATCH`  | `/claims/:id`                     | `accept` / `decline` / `withdraw` / `complete` |
| `GET`    | `/threads`                        | Message inbox                            |
| `POST`   | `/listings/:id/messages`          | Send a message                           |
| `POST`   | `/reviews`                        | Rate the other party after completion    |
| `GET`    | `/communities`, `/communities/:slug` | Neighborhood groups                   |
| `POST`   | `/communities/:slug/events`       | Schedule a scrap drive                   |
| `GET`    | `/materials`                      | Grade catalog with current per-lb prices |
| `GET`    | `/prices`                         | Live metal index                         |
| `POST`   | `/prices/estimate`                | Value a hypothetical pile                |
| `GET`    | `/geo/search`, `/geo/reverse`     | Geocoding proxy                          |
| `GET`    | `/yards`                          | Nearby scrap yards                       |
| `GET`    | `/weather`                        | Pickup forecast                          |
| `GET`    | `/stats`                          | Impact totals and leaderboards           |

---

## Commands

| Command               | What it does                                        |
| --------------------- | --------------------------------------------------- |
| `npm run dev`         | API and web app together, both hot-reloading         |
| `npm run build`       | Type-check and build both workspaces                 |
| `npm start`           | Run the built API                                    |
| `npm test`            | Server test suite                                    |
| `npm run typecheck`   | Type-check both workspaces                           |
| `npm run seed`        | Seed demo data (`-- --fresh` wipes first)            |
| `npm run check:apis`  | Verify every free API is reachable from this machine |

---

## Configuration

Copy `.env.example` to `.env` if you want to change anything. Every value has a
working default, and no key is required.

The ones that matter in production:

- `SESSION_SECRET` — required; generate with `openssl rand -hex 32`.
- `OSM_USER_AGENT` — put your own project URL and contact address here. The
  OpenStreetMap Foundation asks for it, and a generic agent can get blocked.
- `CORS_ORIGIN` — the origin serving the built web app.
- `DATA_DIR` — where the SQLite file and uploads live; back this up.

---

## Attribution

Map data and geocoding © [OpenStreetMap](https://www.openstreetmap.org/copyright)
contributors, ODbL. Weather by [Open-Meteo](https://open-meteo.com), CC BY 4.0.
Copper and aluminum quotes via [Stooq](https://stooq.com).

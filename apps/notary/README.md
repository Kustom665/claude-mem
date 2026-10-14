# Notary Desk

Practice management and a tamper-evident electronic journal for mobile notaries
and loan signing agents. Built Pennsylvania-first.

Three things distinguish it from the $9/month notary bookkeeping tools:

1. **The journal is tamper-evident.** Every entry is sealed into a SHA-256 hash
   chain at write time. There is no edit or delete path anywhere in the
   application — a mistake is corrected by appending an amending entry, exactly
   as you would line out and annotate a paper journal. Pennsylvania's RULONA
   permits an electronic journal *provided it is tamper-evident*, which is the
   standard this is built to meet.

2. **Compliance rules are enforced, not documented.** The rules run in opposite
   directions between states — California *requires* a thumbprint for deeds and
   powers of attorney, Pennsylvania *prohibits* recording biometrics at all — so
   the journal form renders a thumbprint field only where it is lawful, and the
   server refuses a fee above the state maximum.

3. **It produces the self-employment tax split.** Fees for notarial acts are
   exempt from SE tax; travel, printing and signing-service fees are not. The
   split has to be captured per act as the work happens, which is why fees live
   on journal entries and not just on invoices.

4. **It helps you find the work, not just record it.** *Find work* is a dated,
   sourced map of where notarization work comes from and how to get on each
   source's vendor list, scored against your own commission and insurance, with
   a pipeline that remembers to follow up. A public *request link* lets people
   ask for you directly. See [`docs/WORK-SOURCES.md`](docs/WORK-SOURCES.md).

Every rule traces to a cited source in [`docs/RESEARCH.md`](docs/RESEARCH.md);
what this niche's software is missing, and what to build next, is in
[`docs/INSIGHTS.md`](docs/INSIGHTS.md).

---

## Quick start

```bash
npm install
cp .env.example .env
npm run setup     # generate client, apply migrations, load demo data
npm run dev       # http://localhost:3000
```

Sign in with the demo notary:

```
demo@notarydesk.test  /  notary-demo-2026
```

The demo account is a Pennsylvania signing agent with a month of work: 12 chained
journal entries, 6 signings, 4 clients, mileage across both 2026 IRS rates, two
invoices, four pipeline entries and two requests from its public link
(`/n/keystone-mobile-notary`). Its commission and background check are
deliberately close to expiry so the dashboard warnings are visible.

```bash
npm test          # unit and filesystem tests, about 280
npm run typecheck # also flags unused code; Next 16 has no `next lint`
npm run build
npm run e2e       # browser flows against a real Postgres; see e2e/README.md
```

`npm run e2e` drives the built app in Chromium with the server in UTC and checks
what was actually stored — the layer that found the defects the unit tests could
not see. CI runs it (`.github/workflows/notary.yml`) alongside typecheck, test and
a no-environment build.

---

## What's in it

| Module | What it does |
|---|---|
| **Journal** | Sealed, hash-chained entries. Search, chain verification, amendments, CSV export with digests, printable audit copy, and a redacted public-inspection view. |
| **Signings** | Appointments with a status pipeline, location, loan/escrow detail, fees, and automatic mileage logging. |
| **Clients** | Title companies, escrow, signing services, law firms, direct clients. Payment terms and revenue per client. |
| **Billing** | Invoices generated from completed unbilled signings, itemized notarial vs service fees. Mileage log. Editable fee schedule with statutory maximums. |
| **Reports** | Schedule C and Schedule SE views with the notarial exemption applied, act counts, and mileage bucketed by IRS rate. |
| **Certificates** | PA RULONA §316 short forms plus generic forms, filled from your commission details and printable. |
| **Compliance** | Commission, E&O, bond and background-check expiry warnings. State-aware journal field rules. |
| **Find work** | A dated, sourced directory of 20 work sources (signing services, title and escrow, law firms, care homes, apostille, directories, RON platforms), each with how to join, what it requires, a readiness score from your own credentials, and the caveats where sources disagree. A pipeline with follow-up reminders; "convert to client" when work starts. |
| **Request link** | A public page at `/n/your-name` where people ask you to call them back. Honeypot, signed form token and database-counted rate limits; no ID numbers or uploads; the Pennsylvania non-attorney statement is printed on it. Requests land in an inbox; accepting one schedules a signing. |
| **Integrations** | Signed outbound webhooks to GoHighLevel. |

---

## The GoHighLevel handoff

This app owns the notary record — journal, acts, fees, compliance state. It is
deliberately **not** a CRM, because a CRM is the one genuinely commoditised part
of this product.

Business events are pushed outward over signed webhooks, and the automation
platform owns pipelines, SMS and email nurture, review requests and rebooking.

| Event | Fires when | Typical use in GHL |
|---|---|---|
| `signing.scheduled` | A signing is created or moves to scheduled/confirmed | Confirmation text, calendar invite |
| `signing.completed` | Status changes to completed | Review request, referral follow-up |
| `signing.cancelled` | Cancelled or no-show | Back to the rebooking pipeline |
| `client.created` | A client is added | Nurture sequence for the title company |
| `invoice.sent` | Invoice marked sent | Payment reminder sequence |
| `invoice.paid` | Invoice settled | Stop reminders, send thanks |
| `journal.entry_created` | An act is recorded | Act-count dashboards |
| `compliance.expiring` | A credential nears expiry | Renewal nudge |
| `request.created` | Someone sends a request through your link | Text the notary at once; start a speed-to-lead sequence |
| `request.accepted` | You accept a request | Confirmation text to the requester with date, time and what to have ready |

Set up in **Settings → Integrations**: paste the URL from a GoHighLevel *Inbound
Webhook* trigger, pick your events, send a test, then map the sample payload in
GHL. Status transitions only fire once, so re-saving a completed signing will
not re-trigger a review campaign.

Deliveries are signed with HMAC-SHA256 over `timestamp.body` and sent as
`x-notarydesk-signature`, with the delivery log and one-click retry in the same
screen. GoHighLevel's inbound webhook step cannot verify an HMAC, so a direct GHL
setup relies on the URL staying secret — the signature is there for when you put
a function in front of it.

---

## Deployment

### Vercel + Postgres

PostgreSQL is the committed default, because Vercel's serverless filesystem is
ephemeral and read-only — SQLite cannot persist there, and `better-sqlite3` is a
native addon that does not belong in a serverless bundle. `src/lib/db.ts` picks
its driver adapter from the `DATABASE_URL` scheme at runtime and loads neither
adapter statically, so only the one you actually use is ever required.

1. Point Vercel at this directory (`apps/notary`) as the project root.
2. Set two environment variables on the project:
   - `DATABASE_URL` — your Postgres connection string
   - `SESSION_SECRET` — generate with
     `node -e "console.log(require('crypto').randomBytes(48).toString('base64url'))"`
3. Build command `npm run build` (which runs `prisma generate` first), install
   command `npm install`.
4. Apply the schema once with `npx prisma migrate deploy`, then optionally
   `npm run db:seed`. Later releases add migrations (Find Work adds two tables
   and some columns; the IRS mileage rate becomes fractional so 72.5¢ is stored
   exactly) — run `migrate deploy` again after pulling, and re-check the
   `anon` privilege query below, which should still report `false` for every
   table including the new ones.

Both variables are runtime requirements, not build ones — `npm run build`
completes with neither of them set, and every route is server-rendered on
demand, so nothing reaches the database while building. A failed build is
therefore never a database problem, which is worth knowing before you go
looking for one.

At runtime the app says plainly what is missing: `db.ts` throws on an absent
`DATABASE_URL`, and it refuses to serve in production without a real
`SESSION_SECRET`.

**Least privilege.** Do not point `DATABASE_URL` at a superuser. Create a role
that can read and write its own tables and nothing else, so a leaked connection
string cannot alter the schema:

```sql
CREATE ROLE notary_app WITH LOGIN PASSWORD '...';
GRANT CONNECT ON DATABASE postgres TO notary_app;
GRANT USAGE ON SCHEMA public TO notary_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO notary_app;
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO notary_app;
```

### On Supabase, close the REST API first

Two Supabase defaults will bite, and the first one is serious.

**The tables are on a public REST API until you take them off.** Supabase
grants `anon` and `authenticated` privileges on everything in the `public`
schema and serves that schema through PostgREST. The key that authenticates
`anon` is meant to be shipped to browsers. Applying this schema and stopping
there leaves the journal readable *and writable* by anyone who has that key —
signer addresses, ID last-4s, and the competency notes a notary writes at a
bedside, plus the ability to insert journal rows that were never notarized.

This app never uses PostgREST; it talks to Postgres directly. So revoke the
API roles outright rather than trying to write policies for them:

```sql
REVOKE ALL ON ALL TABLES IN SCHEMA public FROM anon, authenticated;
REVOKE ALL ON ALL SEQUENCES IN SCHEMA public FROM anon, authenticated;
REVOKE ALL ON ALL FUNCTIONS IN SCHEMA public FROM anon, authenticated;
REVOKE ALL ON SCHEMA public FROM anon, authenticated;

-- and stop them coming back on the next migration
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public
  REVOKE ALL ON TABLES FROM anon, authenticated;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public
  REVOKE ALL ON SEQUENCES FROM anon, authenticated;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public
  REVOKE ALL ON FUNCTIONS FROM anon, authenticated;
```

Confirm it took — `Security Advisor` in the dashboard should be empty, and this
should report `false` for every table:

```sql
SELECT c.relname, has_table_privilege('anon', c.oid, 'SELECT') AS anon_can_read
FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
WHERE n.nspname = 'public' AND c.relkind = 'r' ORDER BY 1;
```

**Use the pooler, not the direct connection.** `db.<ref>.supabase.co` has no
A record — it is IPv6-only — and Vercel's function runtime cannot reach it, so
a direct connection string builds fine and then fails at runtime with a DNS
error. Take the pooler URI from **Connect** in the Supabase dashboard
(`...pooler.supabase.com`, which is IPv4). Through the pooler the username
carries the project ref: `notary_app.<project-ref>`, not `notary_app`. Session
mode on port 5432 is the safe default; transaction mode on 6543 holds fewer
connections open but is fussier about prepared statements.

**Free-tier projects pause themselves.** A Supabase project on the free plan
goes to sleep after about a week with no traffic — no request, no notice, it
just stops answering. The next connection attempt hangs until it times out
rather than failing fast, which reads exactly like a hung deployment rather
than a sleeping database. Waking it takes one click (**Restore project** in
the dashboard) or the Supabase MCP's `restore_project`, and it comes back
with the data intact — this was hit and confirmed harmless mid-review: the
project paused, was restored, and all 58 demo rows and the revoked `anon`
grants were still exactly as left. Worth knowing before a demo, a customer
trial, or any gap longer than a few days: a paused free-tier project is a
bad first impression, and the fix is a page reload away, not a redeploy.

### Going back to SQLite for local work

Set `DATABASE_URL="file:./dev.db"`, change the provider in
`prisma/schema.prisma` back to `sqlite`, and create the database with
`npx prisma db push`. Do not run `migrate deploy`: the committed migrations are
PostgreSQL SQL. The schema itself needs no other change — it is written to the
intersection of both engines (no Prisma enums, no scalar lists, comma-separated
strings where a list is needed, and integer cents for money; the one float is
the IRS per-mile rate, which can be a half cent).

Journals survive the move. The demo journal in this repo was sealed under
SQLite, copied into PostgreSQL, and read back; `tests/journal-migration.vitest.ts`
holds those exact rows, with the digests written at seal time, and asserts they
still verify — both as Prisma returns them and as bare strings out of a SQL
dump, which is what an auditor re-checking your journal would actually have.
Timestamps normalise to UTC regardless of spelling, so a verification does not
depend on the time zone of the machine running it. Move the rows, then open
`/journal/verify` to confirm before trusting them.

### Anywhere else

It is a standard Next.js server app. `npm run build && npm start` behind any
Node host works; keep the SQLite file on a persistent volume if you stay on
SQLite.

---

## How the journal chain works

Each sealed entry stores a SHA-256 digest computed over its own substantive
fields **plus the digest of the entry before it**. Editing a historical entry
changes its digest, which breaks the link to the entry after it, and so on to
the end of the journal. `/journal/verify` recomputes the whole chain and reports
exactly where a break starts, distinguishing four failure modes: a row edited in
place, a row spliced in, a row deleted, and a duplicated journal number.

Field names and values are joined with control characters (`U+0000`, `U+0001`)
rather than printable separators, so a document type of `Deed` with a
description of `of Trust` cannot collide with `Deedof` / `Trust`.

**What this does not prove.** Anyone with database access can rewrite rows *and*
recompute every digest. The defense is external: record your head digest
somewhere outside the system — email it to yourself monthly, or write it in a
notebook. A digest held elsewhere on a known date turns "internally consistent"
into "provably unchanged since then". The verify page says this in plain
language rather than overselling the guarantee.

---

## Architecture notes

- **Next.js 16** App Router, React 19, server components and server actions
  throughout. Client components only where interactivity demands it.
- **Prisma 7** with driver adapters. The connection URL lives in
  `prisma.config.ts`, not the schema — a Prisma 7 change. Relative `file:` URLs
  resolve against the project root.
- **Multi-tenancy** is `requireUser()` plus a `userId` filter on every query.
  There is no shared query path that omits the scope; writes that take an id use
  `updateMany`/`deleteMany` scoped by `userId`, so a forged id affects zero rows.
- **Sessions** are opaque random tokens stored server-side, not JWTs, so they
  can actually be revoked. The database holds an HMAC of the token, not the
  token.
- **Money** is integer cents everywhere. The IRS per-mile rate is the one
  fractional value (72.5¢ for the first half of 2026), stored exactly and valued
  at the rate in force on the notary's calendar day.
- **Time zones.** A notary's day is in their own zone, and a hosted server runs
  in UTC. Date and time fields typed into forms are read in the notary's zone
  (`interpretWallClock`), calendar dates are stored at noon so they cannot slip a
  day, and "today", "this month", the tax year, journal date ranges and expiry
  checks all use the notary's zone. The tests assert absolute instants, so they
  pass under any process zone.
- **Forms keep what you typed.** React 19 resets an uncontrolled form when its
  action finishes — including when the action rejected the input. Every form
  that submits to a server action renders `<ActionForm>`, which avoids that, and
  `tests/forms.vitest.ts` fails if a form goes back to a bare `<form action>`.
  Cross-field validation rules run even when another field failed, so one submit
  reports every mistake.
- **The public pages** (`/n/…`) are the only unauthenticated writes. They read the
  notary through an allow-listed `select` (`src/lib/public-notary.ts`), never the
  whole row; a test fails if a private column is named there.
- **CSV exports** neutralise formula injection — a signer named `=cmd|...` must
  not execute when an accountant opens the file.

---

## Legal disclaimer

This software is a record-keeping and business tool. It is **not legal advice**
and it is not a substitute for your commissioning authority's handbook.

Reference data — fee maximums, journal rules, certificate wording — was captured
on **10 August 2026** and is displayed in the app with that date attached.
Notary law changes every legislative session. Verify anything you are relying on
against your own state's current rules before acting on it, and confirm with
your commissioning authority that an electronic journal is acceptable as your
journal of record before retiring a paper book.

The tax reporting is a bookkeeping aid, not tax advice. Hand the figures to a
preparer rather than filing from them directly.

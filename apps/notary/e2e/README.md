# Browser flows

End-to-end checks that drive the built app in a real browser (Chromium through
Playwright) against a real PostgreSQL, with the server running in **UTC** — the
zone a hosted deployment uses, and the one most likely to expose a bug that a
notary's own clock would hide.

They exist because the unit tests could not see the defects they found: forms
that wiped everything typed when a submission was rejected, dates read in the
server's zone instead of the notary's, a page that built fine and 404'd, an IRS
rate that crashed the mileage form. Each flow asserts what was really stored, by
querying the database directly.

| Script | What it covers |
|---|---|
| `smoke.mjs` | Every signed-in page renders with nothing red in the console |
| `public-form.mjs` | The public request link: honeypot, signed token, rate limit, validation, paused link, expired commission |
| `flows-inbox.mjs` | Requests inbox: contact links, accept → signing at the right local time, decline/spam/reopen/delete, tenant isolation |
| `flows-settings.mjs` | Request-link settings: slug rules and conflicts, switching on and off, privacy toggles |
| `flows-pipeline.mjs` | Find work: tracking, follow-up dates on the notary's calendar, convert to client, readiness checklist |
| `flows-signing.mjs` | A rejected form keeps what was typed (text and selects); 2:30 pm is stored as 2:30 pm Eastern |
| `flows-pending.mjs` | A submit button shows it is working and cannot be double-clicked |
| `flows-misc.mjs` | Fractional IRS mileage rate, commission dates that do not drift, the journal form, journal date ranges |
| `verify-chain.mjs` | The journal chain still verifies after entries were added through the app |

## Running them

You need a built app listening on a port, a database it is using, `psql`, and
Chromium.

```bash
# 1. a database, migrated, with the app's own limited role (see the README's
#    "Least privilege" section), and the Playwright browser
npx prisma migrate deploy
npx playwright-core install chromium     # or set CHROMIUM_PATH to one you have

# 2. build and start the app in UTC
npm run build
TZ=UTC DATABASE_URL=postgresql://notary_app:…@127.0.0.1:5432/notary \
  SESSION_SECRET=any-long-random-string npm start -- -p 3100 &

# 3. run everything (reseeds the demo data before each flow)
E2E_ADMIN_DATABASE_URL=postgresql://postgres:…@127.0.0.1:5432/notary \
PGHOST=127.0.0.1 PGPORT=5432 PGUSER=postgres PGPASSWORD=… PGDATABASE=notary \
  npm run e2e

# or one flow:
npm run e2e -- public-form
```

| Variable | Meaning |
|---|---|
| `E2E_BASE_URL` | Where the app listens. Default `http://127.0.0.1:3100`. |
| `E2E_ADMIN_DATABASE_URL` | A connection string that can write to the app's database. Used only to reseed. |
| `PGHOST`, `PGPORT`, `PGUSER`, `PGPASSWORD`, `PGDATABASE` | Where `psql` connects, to arrange state and to assert what was stored. |
| `PSQL` | A `psql` that is not on the `PATH`. |
| `CHROMIUM_PATH` | A Chromium to use instead of the one Playwright manages. |

The flows write to the database: use a throwaway one, never a real notary's. The
runner reseeds the demo account (which deletes and recreates only that account)
before each flow.

CI runs the same thing: see `.github/workflows/notary.yml` at the repository root.

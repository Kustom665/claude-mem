# White-label Reseller Dashboard

A multi-tenant dashboard where a marketing agency signs up, brands the product
as their own, and resells missed-call text-back automation to local businesses.
It is the control plane for an existing Twilio + n8n backend — this app owns
agencies, clients, branding and seat billing; the backend still owns the calls
and the texts.

**Stack:** Next.js 16 (App Router) · Tailwind CSS v4 · Supabase (Postgres, Auth,
Storage) · Stripe · deployed to Vercel.

---

## What is built

| Feature | Where |
| --- | --- |
| Agency auth — sign up, get a workspace | `src/app/(auth)/`, `src/actions/auth.ts` |
| Branding — logo, colour, business name | `src/app/(app)/settings/branding/`, `src/lib/branding.ts` |
| Client management — add / edit / pause / remove | `src/app/(app)/clients/`, `src/actions/clients.ts` |
| Client list — status + leads this month | `src/app/(app)/dashboard/` |
| Stripe — one subscription per active seat | `src/lib/seats.ts`, `src/app/api/stripe/webhook/` |
| Backend integration seam | `src/app/api/automation/` |

Out of scope for v1: client-level logins, lead detail views, team seats inside
an agency, analytics.

---

## Setup

### 1. Supabase

Create a project, then apply the migrations in order — SQL Editor, or
`supabase db push` if you link the project:

```
supabase/migrations/0001_agencies.sql      -- agencies, signup trigger, RLS
supabase/migrations/0002_clients_leads.sql -- clients, leads, lead-count view
supabase/migrations/0003_logo_storage.sql  -- public agency-logos bucket
```

In **Authentication → URL Configuration**, add `<your-site>/auth/callback` as a
redirect URL so email confirmation links land back in the app.

### 2. Stripe

1. Create a product with a **recurring monthly price** — this is what you pay
   per active client seat. Copy the price ID into `STRIPE_SEAT_PRICE_ID`.
2. Add a webhook endpoint pointing at `<your-site>/api/stripe/webhook`,
   subscribed to:
   - `checkout.session.completed`
   - `payment_method.attached`
   - `customer.subscription.created` / `.updated` / `.deleted`
   - `invoice.payment_failed`
3. Copy the signing secret into `STRIPE_WEBHOOK_SECRET`.
4. Enable the **billing portal** in Stripe settings if you want the
   "Invoices & portal" button to work.

Locally: `stripe listen --forward-to localhost:3000/api/stripe/webhook`.

### 3. Environment

Copy `.env.example` to `.env.local` and fill it in. Every variable is read
lazily, so the app boots and shows a readable error rather than failing at
build time when something is missing. Stripe is optional during early setup —
without it you can still add clients, they just do not consume a paid seat.

### 4. Run

```bash
npm install
npm run dev        # http://localhost:3000
npm run build      # production build + typecheck
npm run lint
```

### 5. Deploy

Point Vercel at this directory (set **Root Directory** to `reseller-dashboard`
if the repository root is elsewhere), add the same environment variables, and
set `NEXT_PUBLIC_SITE_URL` to the deployed origin.

---

## Data model

```
agencies                                clients                          leads
  id                                      id                               id
  owner_id      -> auth.users             agency_id -> agencies            client_id -> clients
  name                                    business_name                    caller_number
  logo_url                                phone_number  (unique, E.164)    captured_at
  primary_color                           timezone                         replied
  stripe_customer_id                      hours         (jsonb, 7 days)
  has_payment_method                      auto_reply_message
                                          status        (active | paused)
                                          resale_price_cents
                                          stripe_subscription_id
                                          seat_status
```

`public.client_overview` is `clients` plus `leads_this_month` and
`replied_this_month`. It is declared `security_invoker`, so the row-level
policies below still apply to it.

Beyond the columns in the original spec, three exist because the features need
them: `agencies.owner_id` (there is no workspace without a link to the auth
user), `clients.timezone` (business hours mean nothing without one), and the
Stripe bookkeeping columns.

### Security model

- **agencies** — an owner can read their row and update only `name`,
  `logo_url` and `primary_color`. Column-level grants keep
  `stripe_customer_id` and `has_payment_method` out of reach of the browser.
- **clients** — read-only to `authenticated`, scoped by RLS to the caller's
  agency. Every write goes through a server action using the service role,
  because every write also moves Stripe seat billing. Authorisation is an
  explicit `agency_id` check in the action.
- **leads** — read-only to `authenticated` via client ownership. Written only
  by the automation endpoint.
- **storage** — logos live at `agency-logos/<agency_id>/…`; write policies key
  off that first path segment. The bucket is public-read and SVG is not an
  allowed type.

---

## How branding reaches the product

`agencies.primary_color` is turned into CSS custom properties by
`brandStyle()` and set as an inline style on the dashboard shell. `globals.css`
maps those onto Tailwind utilities with `@theme inline`, so `bg-brand`,
`text-brand-fg` and friends re-theme the whole dashboard from one column — no
rebuild, no client-side flash.

For SMS, `agencies.name` becomes the sender name via `smsSenderName()`, which
strips characters that force a 70-character UCS-2 segment and caps the result
at 32. Auto-reply templates support `{{business_name}}`, `{{sender}}` and
`{{agency_name}}`, resolved at send time by `renderAutoReply()` — so renaming
the agency changes every client's outgoing text immediately.

---

## Backend integration (`/api/automation`)

The one seam the existing Twilio + n8n flow needs. Authenticate with the shared
secret in `AUTOMATION_API_SECRET`, sent as `x-automation-secret`.

**Look up a client by the number that was called** — returns the branding, the
hours, and the auto-reply already rendered:

```bash
curl "$SITE/api/automation?phone=%2B15550101234" \
  -H "x-automation-secret: $AUTOMATION_API_SECRET"
```

```json
{
  "client": {
    "id": "…", "business_name": "Ridgeline Plumbing",
    "phone_number": "+15550101234", "status": "active",
    "timezone": "America/New_York", "hours": { "mon": { "closed": false, "open": "09:00", "close": "17:00" }, "…": {} },
    "open_now": false
  },
  "branding": {
    "agency_name": "Northside Marketing",
    "sms_sender_name": "Northside Marketing",
    "logo_url": "https://…", "primary_color": "#0d9488"
  },
  "auto_reply": {
    "template": "Hi! Thanks for calling {{business_name}} … — {{sender}}",
    "message":  "Hi! Thanks for calling Ridgeline Plumbing … — Northside Marketing"
  }
}
```

**Record a captured lead** — this is what fills the "leads this month" column:

```bash
curl -X POST "$SITE/api/automation" \
  -H "x-automation-secret: $AUTOMATION_API_SECRET" \
  -H "content-type: application/json" \
  -d '{"phone":"+15550101234","caller_number":"+15559876543","replied":true}'
```

`captured_at` is optional and defaults to now. Responses are `401` for a bad
secret, `404` when no client owns that number, `400` for a malformed body.

---

## Billing behaviour

- A seat is one Stripe subscription on the agency's customer, created when a
  client becomes **active** and cancelled when it becomes **paused** or is
  removed. The agency's card pays for all of them.
- Activating a client without a card on file saves it as paused and says so
  rather than creating a subscription that can never charge.
- Subscriptions are created with `payment_behavior: "error_if_incomplete"`, so
  a declined card surfaces immediately instead of leaving a seat that silently
  never bills.
- If Stripe ends a subscription outside the dashboard — dunning gives up, or
  it is cancelled from the portal — the webhook pauses the client to match.
- `clients.resale_price_cents` is what the agency charges its own client. It is
  recorded for margin reporting and is never sent to Stripe.

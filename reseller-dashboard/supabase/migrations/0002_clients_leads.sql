-- ---------------------------------------------------------------------------
-- 0002_clients_leads
--
-- clients : one row per client business the agency resells the missed-call
--           text-back service to. Each active client is one Stripe seat.
-- leads   : one row per missed call captured by the Twilio/n8n backend.
-- ---------------------------------------------------------------------------

do $$
begin
  if not exists (select 1 from pg_type where typname = 'client_status') then
    create type public.client_status as enum ('active', 'paused');
  end if;
end
$$;

create table if not exists public.clients (
  id                   uuid primary key default gen_random_uuid(),
  agency_id            uuid not null references public.agencies (id) on delete cascade,
  business_name        text not null,
  -- The Twilio number that rings for this business. Unique so the automation
  -- backend can resolve an inbound call straight to one client.
  phone_number         text not null unique,
  -- IANA zone. Business hours are meaningless without it.
  timezone             text not null default 'America/New_York',
  -- {"mon":{"closed":false,"open":"09:00","close":"17:00"}, ... "sun":{...}}
  hours                jsonb not null default '{
    "mon": {"closed": false, "open": "09:00", "close": "17:00"},
    "tue": {"closed": false, "open": "09:00", "close": "17:00"},
    "wed": {"closed": false, "open": "09:00", "close": "17:00"},
    "thu": {"closed": false, "open": "09:00", "close": "17:00"},
    "fri": {"closed": false, "open": "09:00", "close": "17:00"},
    "sat": {"closed": true,  "open": "09:00", "close": "17:00"},
    "sun": {"closed": true,  "open": "09:00", "close": "17:00"}
  }'::jsonb,
  auto_reply_message   text not null,
  status               public.client_status not null default 'active',

  -- What the agency charges this client. Informational only: never sent to
  -- Stripe, never used to compute what the agency is billed.
  resale_price_cents   integer,

  -- One Stripe subscription per client seat, billed to the agency's card.
  stripe_subscription_id text unique,
  seat_status          text not null default 'none',

  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now(),

  constraint clients_business_name_not_blank
    check (length(btrim(business_name)) between 1 and 120),
  constraint clients_phone_number_e164
    check (phone_number ~ '^\+[1-9]\d{7,14}$'),
  constraint clients_timezone_not_blank
    check (length(btrim(timezone)) > 0),
  constraint clients_hours_has_every_day
    check (hours ?& array['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun']),
  constraint clients_auto_reply_message_length
    check (length(btrim(auto_reply_message)) between 1 and 1200),
  constraint clients_resale_price_non_negative
    check (resale_price_cents is null or resale_price_cents >= 0),
  constraint clients_seat_status_known
    check (seat_status in ('none', 'active', 'trialing', 'past_due', 'canceled', 'incomplete'))
);

create index if not exists clients_agency_id_created_at_idx
  on public.clients (agency_id, created_at desc);

drop trigger if exists clients_set_updated_at on public.clients;
create trigger clients_set_updated_at
  before update on public.clients
  for each row execute function public.set_updated_at();

create table if not exists public.leads (
  id           uuid primary key default gen_random_uuid(),
  client_id    uuid not null references public.clients (id) on delete cascade,
  caller_number text not null,
  captured_at  timestamptz not null default now(),
  replied      boolean not null default false,

  constraint leads_caller_number_not_blank check (length(btrim(caller_number)) > 0)
);

create index if not exists leads_client_id_captured_at_idx
  on public.leads (client_id, captured_at desc);

-- ---------------------------------------------------------------------------
-- Row level security
--
-- Reads are RLS-scoped to the caller's agency. Writes are deliberately NOT
-- granted to `authenticated`: every client mutation changes Stripe seat
-- billing, so it goes through a server action using the service role after an
-- explicit ownership check. Leads are written only by the automation backend.
-- ---------------------------------------------------------------------------
alter table public.clients enable row level security;
alter table public.leads enable row level security;

revoke all on public.clients from anon, authenticated;
revoke all on public.leads from anon, authenticated;
grant select on public.clients to authenticated;
grant select on public.leads to authenticated;

drop policy if exists "Agencies can read their own clients" on public.clients;
create policy "Agencies can read their own clients"
  on public.clients for select
  to authenticated
  using (agency_id = public.current_agency_id());

drop policy if exists "Agencies can read leads for their own clients" on public.leads;
create policy "Agencies can read leads for their own clients"
  on public.leads for select
  to authenticated
  using (
    exists (
      select 1
      from public.clients c
      where c.id = leads.client_id
        and c.agency_id = public.current_agency_id()
    )
  );

-- ---------------------------------------------------------------------------
-- Client list view: clients plus this calendar month's lead counts.
--
-- security_invoker so the two policies above still apply to whoever queries it.
-- The month boundary is UTC; matching it to each client's timezone would make
-- the column non-indexable for a number that only drives a dashboard cell.
-- ---------------------------------------------------------------------------
create or replace view public.client_overview
with (security_invoker = on) as
select
  c.*,
  coalesce(l.leads_this_month, 0)   as leads_this_month,
  coalesce(l.replied_this_month, 0) as replied_this_month
from public.clients c
left join lateral (
  select
    count(*)                             as leads_this_month,
    count(*) filter (where l.replied)    as replied_this_month
  from public.leads l
  where l.client_id = c.id
    and l.captured_at >= date_trunc('month', now() at time zone 'utc')
) l on true;

revoke all on public.client_overview from anon, authenticated;
grant select on public.client_overview to authenticated;

-- TradeDesk core schema.
-- Multi-tenant: every business-data row carries account_id and is protected by
-- RLS. Application-layer checks (src/core/auth.ts) are the first gate; these
-- policies are the backstop so an application bug cannot cross tenants.

create type plan_key   as enum ('starter','pro','premium');
create type member_role as enum ('owner','admin','staff','customer');
create type doc_status  as enum ('draft','sent','accepted','declined','paid','void');
create type job_status  as enum ('unscheduled','scheduled','in_progress','done','cancelled');

create table accounts (
  id              uuid primary key default gen_random_uuid(),
  business_name   text not null,
  plan            plan_key not null default 'starter',
  -- Anchors the metered billing period; usage counters reset relative to this.
  period_start    timestamptz not null default now(),
  stripe_customer_id text unique,
  created_at      timestamptz not null default now()
);

create table members (
  id         uuid primary key default gen_random_uuid(),
  account_id uuid not null references accounts(id) on delete cascade,
  user_id    uuid not null,
  role       member_role not null default 'staff',
  email      text not null,
  created_at timestamptz not null default now(),
  unique (account_id, user_id)
);
create index on members (user_id);

-- Exactly one owner per account, enforced by the database rather than by trust.
create unique index members_one_owner on members (account_id) where role = 'owner';

create table customers (
  id         uuid primary key default gen_random_uuid(),
  account_id uuid not null references accounts(id) on delete cascade,
  name       text not null,
  email      text,
  phone      text,
  address    text,
  notes      text,
  archived_at timestamptz,
  created_at timestamptz not null default now()
);
create index on customers (account_id, name);

create table documents (
  id          uuid primary key default gen_random_uuid(),
  account_id  uuid not null references accounts(id) on delete cascade,
  customer_id uuid not null references customers(id) on delete restrict,
  kind        text not null check (kind in ('estimate','invoice')),
  number      text not null,
  status      doc_status not null default 'draft',
  -- Money is stored in integer minor units. Never floats.
  subtotal_cents integer not null default 0,
  tax_cents      integer not null default 0,
  total_cents    integer not null default 0,
  currency    text not null default 'USD',
  due_at      timestamptz,
  -- Set when an accepted estimate is converted, preserving the audit trail.
  converted_from uuid references documents(id),
  created_at  timestamptz not null default now(),
  unique (account_id, kind, number)
);
create index on documents (account_id, customer_id, status);

create table line_items (
  id          uuid primary key default gen_random_uuid(),
  document_id uuid not null references documents(id) on delete cascade,
  position    integer not null,
  description text not null,
  quantity    numeric(12,3) not null check (quantity >= 0),
  unit_cents  integer not null check (unit_cents >= 0),
  tax_rate    numeric(6,4) not null default 0 check (tax_rate >= 0),
  unique (document_id, position)
);

create table jobs (
  id          uuid primary key default gen_random_uuid(),
  account_id  uuid not null references accounts(id) on delete cascade,
  customer_id uuid not null references customers(id) on delete restrict,
  document_id uuid references documents(id) on delete set null,
  title       text not null,
  status      job_status not null default 'unscheduled',
  scheduled_start timestamptz,
  scheduled_end   timestamptz,
  assigned_to uuid references members(id) on delete set null,
  created_at  timestamptz not null default now(),
  check (scheduled_end is null or scheduled_start is null or scheduled_end > scheduled_start)
);
create index on jobs (account_id, scheduled_start);

create table timesheets (
  id         uuid primary key default gen_random_uuid(),
  account_id uuid not null references accounts(id) on delete cascade,
  job_id     uuid not null references jobs(id) on delete cascade,
  member_id  uuid not null references members(id) on delete restrict,
  started_at timestamptz not null,
  ended_at   timestamptz,
  approved_by uuid references members(id),
  check (ended_at is null or ended_at > started_at)
);

-- Metered usage per billing period, backing checkMeter() in src/core/plans.ts.
create table usage_counters (
  account_id   uuid not null references accounts(id) on delete cascade,
  meter        text not null,
  period_start timestamptz not null,
  used         integer not null default 0 check (used >= 0),
  primary key (account_id, meter, period_start)
);

-- Append-only. Every privileged action the owner/admin takes lands here.
create table audit_log (
  id         bigserial primary key,
  account_id uuid not null references accounts(id) on delete cascade,
  actor_id   uuid,
  action     text not null,
  target     text,
  metadata   jsonb not null default '{}',
  created_at timestamptz not null default now()
);
create index on audit_log (account_id, created_at desc);

-- ---------------------------------------------------------------------------
-- Row-level security
-- ---------------------------------------------------------------------------

-- Accounts the current JWT's user belongs to. STABLE so the planner caches it
-- per statement instead of re-running the subquery for every row.
create or replace function current_account_ids() returns setof uuid
language sql stable security definer set search_path = public as $$
  select account_id from members where user_id = auth.uid()
$$;

create or replace function current_role_in(acct uuid) returns member_role
language sql stable security definer set search_path = public as $$
  select role from members where user_id = auth.uid() and account_id = acct
$$;

do $$
declare t text;
begin
  foreach t in array array[
    'accounts','members','customers','documents','jobs',
    'timesheets','usage_counters','audit_log'
  ] loop
    execute format('alter table %I enable row level security', t);
    execute format('alter table %I force row level security', t);
  end loop;
end $$;

create policy tenant_read on customers for select
  using (account_id in (select current_account_ids()));

-- Portal customers must never read the CRM roster; staff and up may.
create policy tenant_write on customers for all
  using (account_id in (select current_account_ids())
         and current_role_in(account_id) <> 'customer')
  with check (account_id in (select current_account_ids())
              and current_role_in(account_id) <> 'customer');

create policy tenant_docs on documents for all
  using (account_id in (select current_account_ids()))
  with check (account_id in (select current_account_ids()));

create policy tenant_jobs on jobs for all
  using (account_id in (select current_account_ids()))
  with check (account_id in (select current_account_ids()));

create policy tenant_timesheets on timesheets for all
  using (account_id in (select current_account_ids()))
  with check (account_id in (select current_account_ids()));

create policy tenant_members on members for select
  using (account_id in (select current_account_ids()));

-- Only the owner may alter membership; prevents self-promotion.
create policy owner_manages_members on members for all
  using (current_role_in(account_id) = 'owner')
  with check (current_role_in(account_id) = 'owner');

-- Audit log is readable by admins/owners and never mutable from the client.
create policy audit_read on audit_log for select
  using (current_role_in(account_id) in ('owner','admin'));

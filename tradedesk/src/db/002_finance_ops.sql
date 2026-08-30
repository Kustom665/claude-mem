-- Finance module and Operations log.
--
-- Both are owner/admin only. Enforced three times: role permissions in
-- src/core/auth.ts, the RLS policies below, and a plan-feature gate
-- (finance_suite / ops_log) checked at the API boundary.

create extension if not exists pgcrypto;

-- ---------------------------------------------------------------------------
-- Finance: company tax profile
-- ---------------------------------------------------------------------------

create type entity_type    as enum ('sole_prop','partnership','llc','s_corp','c_corp','nonprofit');
create type filing_freq    as enum ('monthly','quarterly','annually');

create table company_tax_profile (
  account_id     uuid primary key references accounts(id) on delete cascade,
  legal_name     text not null,
  entity_type    entity_type not null,

  -- Federal EIN is a sensitive identifier. Store it encrypted and keep only the
  -- last four in plaintext for display, so listing screens never decrypt.
  ein_encrypted  bytea,
  ein_last4      char(4),

  state_tax_id_encrypted bytea,
  filing_state   text,
  filing_frequency filing_freq not null default 'quarterly',
  -- Fiscal year end as month/day; year varies, so a date column would mislead.
  fiscal_year_end_month smallint check (fiscal_year_end_month between 1 and 12),
  fiscal_year_end_day   smallint check (fiscal_year_end_day between 1 and 31),
  sales_tax_rate numeric(6,4) not null default 0 check (sales_tax_rate >= 0),
  updated_at     timestamptz not null default now(),
  updated_by     uuid references members(id)
);

-- ---------------------------------------------------------------------------
-- Finance: pay runs
-- ---------------------------------------------------------------------------

create type pay_run_status as enum ('draft','pending_approval','approved','paid','void');

create table pay_runs (
  id           uuid primary key default gen_random_uuid(),
  account_id   uuid not null references accounts(id) on delete cascade,
  period_start date not null,
  period_end   date not null,
  pay_date     date not null,
  status       pay_run_status not null default 'draft',
  -- Denormalized totals in integer minor units, recomputed from lines on write.
  gross_cents  bigint not null default 0 check (gross_cents >= 0),
  tax_cents    bigint not null default 0 check (tax_cents >= 0),
  net_cents    bigint not null default 0 check (net_cents >= 0),
  approved_by  uuid references members(id),
  approved_at  timestamptz,
  created_at   timestamptz not null default now(),
  check (period_end >= period_start),
  -- An approved run must record who approved it; prevents silent approval.
  check ((status in ('approved','paid')) = (approved_by is not null))
);
create index on pay_runs (account_id, pay_date desc);

create table pay_run_lines (
  id          uuid primary key default gen_random_uuid(),
  pay_run_id  uuid not null references pay_runs(id) on delete cascade,
  member_id   uuid not null references members(id) on delete restrict,
  hours       numeric(8,2) check (hours is null or hours >= 0),
  rate_cents  integer check (rate_cents is null or rate_cents >= 0),
  gross_cents integer not null check (gross_cents >= 0),
  tax_cents   integer not null default 0 check (tax_cents >= 0),
  net_cents   integer not null check (net_cents >= 0),
  notes       text,
  -- Net is what actually leaves the account; it must reconcile exactly.
  check (net_cents = gross_cents - tax_cents),
  unique (pay_run_id, member_id)
);

-- ---------------------------------------------------------------------------
-- Operations log: user-defined entry types with typed custom fields
-- ---------------------------------------------------------------------------

create table oplog_templates (
  id          uuid primary key default gen_random_uuid(),
  account_id  uuid not null references accounts(id) on delete cascade,
  name        text not null,
  description text,
  -- Ordered field definitions:
  --   [{ key, label, type, required, options?, min?, max? }]
  -- type is one of: text | number | date | boolean | select | member | customer
  fields      jsonb not null default '[]',
  archived_at timestamptz,
  created_at  timestamptz not null default now(),
  unique (account_id, name),
  check (jsonb_typeof(fields) = 'array')
);

create table oplog_entries (
  id          uuid primary key default gen_random_uuid(),
  account_id  uuid not null references accounts(id) on delete cascade,
  template_id uuid not null references oplog_templates(id) on delete restrict,
  -- The operational date being recorded, which is not always the entry date.
  occurred_on date not null default current_date,
  -- Values keyed by the template's field keys. Validated in the application
  -- against the template at write time; see src/core/oplog.ts.
  values      jsonb not null default '{}',
  job_id      uuid references jobs(id) on delete set null,
  created_by  uuid not null references members(id),
  created_at  timestamptz not null default now(),
  -- Entries are corrected by superseding, never by silent edit, so the original
  -- record survives. NULL means this is the current version.
  superseded_by uuid references oplog_entries(id),
  check (jsonb_typeof(values) = 'object')
);
create index on oplog_entries (account_id, occurred_on desc);
create index on oplog_entries (template_id);
-- Most reads want only current entries; keep that path off the full table.
create index on oplog_entries (account_id, occurred_on desc) where superseded_by is null;
-- Ad-hoc filtering on custom field values.
create index oplog_entries_values_gin on oplog_entries using gin (values jsonb_path_ops);

-- ---------------------------------------------------------------------------
-- Row-level security: owner and admin only, on every table in this migration
-- ---------------------------------------------------------------------------

do $$
declare t text;
begin
  foreach t in array array[
    'company_tax_profile','pay_runs','pay_run_lines',
    'oplog_templates','oplog_entries'
  ] loop
    execute format('alter table %I enable row level security', t);
    execute format('alter table %I force row level security', t);
  end loop;
end $$;

create policy finance_admin_only on company_tax_profile for all
  using (current_role_in(account_id) in ('owner','admin'))
  with check (current_role_in(account_id) in ('owner','admin'));

create policy pay_runs_admin_only on pay_runs for all
  using (current_role_in(account_id) in ('owner','admin'))
  with check (current_role_in(account_id) in ('owner','admin'));

-- pay_run_lines has no account_id of its own; scope it through its parent run.
create policy pay_run_lines_admin_only on pay_run_lines for all
  using (exists (
    select 1 from pay_runs r
    where r.id = pay_run_id
      and current_role_in(r.account_id) in ('owner','admin')))
  with check (exists (
    select 1 from pay_runs r
    where r.id = pay_run_id
      and current_role_in(r.account_id) in ('owner','admin')));

create policy oplog_templates_admin_only on oplog_templates for all
  using (current_role_in(account_id) in ('owner','admin'))
  with check (current_role_in(account_id) in ('owner','admin'));

create policy oplog_entries_admin_only on oplog_entries for all
  using (current_role_in(account_id) in ('owner','admin'))
  with check (current_role_in(account_id) in ('owner','admin'));

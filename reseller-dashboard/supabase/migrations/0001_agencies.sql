-- ---------------------------------------------------------------------------
-- 0001_agencies
--
-- One agency == one workspace == one Supabase Auth user (v1 has no
-- client-level login, so agency ownership is a simple 1:1 with auth.users).
-- ---------------------------------------------------------------------------

create extension if not exists pgcrypto with schema extensions;

-- Keeps updated_at honest without the application having to remember.
create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create table if not exists public.agencies (
  id                 uuid primary key default gen_random_uuid(),
  owner_id           uuid not null unique references auth.users (id) on delete cascade,
  name               text not null,
  logo_url           text,
  primary_color      text not null default '#4f46e5',
  stripe_customer_id text unique,
  -- Mirrors "this customer has a usable default card in Stripe". Kept here so
  -- the dashboard can gate seat creation without a Stripe round-trip on render.
  has_payment_method boolean not null default false,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),

  constraint agencies_name_not_blank check (length(btrim(name)) between 1 and 120),
  constraint agencies_primary_color_hex check (primary_color ~* '^#[0-9a-f]{6}$')
);

drop trigger if exists agencies_set_updated_at on public.agencies;
create trigger agencies_set_updated_at
  before update on public.agencies
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- Workspace bootstrap: signing up creates the agency row.
-- ---------------------------------------------------------------------------
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.agencies (owner_id, name)
  values (
    new.id,
    left(
      coalesce(
        nullif(btrim(new.raw_user_meta_data ->> 'agency_name'), ''),
        nullif(split_part(coalesce(new.email, ''), '@', 1), ''),
        'My Agency'
      ),
      120
    )
  )
  on conflict (owner_id) do nothing;

  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- ---------------------------------------------------------------------------
-- Row level security
--
-- An agency may read its own row and edit only its branding columns.
-- stripe_customer_id / has_payment_method are written by the service role
-- (Stripe webhooks + billing actions) and are not client-writable.
-- ---------------------------------------------------------------------------
alter table public.agencies enable row level security;

revoke all on public.agencies from anon, authenticated;
grant select on public.agencies to authenticated;
grant update (name, logo_url, primary_color) on public.agencies to authenticated;

drop policy if exists "Agency owners can read their agency" on public.agencies;
create policy "Agency owners can read their agency"
  on public.agencies for select
  to authenticated
  using (owner_id = (select auth.uid()));

drop policy if exists "Agency owners can update their agency" on public.agencies;
create policy "Agency owners can update their agency"
  on public.agencies for update
  to authenticated
  using (owner_id = (select auth.uid()))
  with check (owner_id = (select auth.uid()));

-- Resolves the caller's workspace once so client/lead policies stay readable.
-- security definer: reads the caller's own agency row only.
create or replace function public.current_agency_id()
returns uuid
language sql
stable
security definer
set search_path = ''
as $$
  select id from public.agencies where owner_id = (select auth.uid());
$$;

revoke all on function public.current_agency_id() from public;
grant execute on function public.current_agency_id() to authenticated;

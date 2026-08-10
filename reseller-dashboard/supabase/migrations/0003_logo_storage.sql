-- ---------------------------------------------------------------------------
-- 0003_logo_storage
--
-- Public bucket for agency logos. Objects are stored at <agency_id>/<file>,
-- which is what the write policies key off.
--
-- SVG is deliberately excluded: the bucket is world-readable and an SVG can
-- carry script that would then execute on the storage origin.
-- ---------------------------------------------------------------------------

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'agency-logos',
  'agency-logos',
  true,
  2097152, -- 2 MB
  array['image/png', 'image/jpeg', 'image/webp']
)
on conflict (id) do update
set public             = excluded.public,
    file_size_limit    = excluded.file_size_limit,
    allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists "Agency logos are publicly readable" on storage.objects;
create policy "Agency logos are publicly readable"
  on storage.objects for select
  to public
  using (bucket_id = 'agency-logos');

drop policy if exists "Agencies can upload their own logo" on storage.objects;
create policy "Agencies can upload their own logo"
  on storage.objects for insert
  to authenticated
  with check (
    bucket_id = 'agency-logos'
    and (storage.foldername(name))[1] = public.current_agency_id()::text
  );

drop policy if exists "Agencies can replace their own logo" on storage.objects;
create policy "Agencies can replace their own logo"
  on storage.objects for update
  to authenticated
  using (
    bucket_id = 'agency-logos'
    and (storage.foldername(name))[1] = public.current_agency_id()::text
  )
  with check (
    bucket_id = 'agency-logos'
    and (storage.foldername(name))[1] = public.current_agency_id()::text
  );

drop policy if exists "Agencies can delete their own logo" on storage.objects;
create policy "Agencies can delete their own logo"
  on storage.objects for delete
  to authenticated
  using (
    bucket_id = 'agency-logos'
    and (storage.foldername(name))[1] = public.current_agency_id()::text
  );

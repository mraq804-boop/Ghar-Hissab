-- Meter Watch: readings between bills so each LESCO meter can stay under its monthly unit limit.

alter table public.utility_bills add column previous_reading integer check (previous_reading is null or previous_reading >= 0);
alter table public.utility_bills add column present_reading integer check (present_reading is null or present_reading >= 0);
alter table public.utility_bills add column history jsonb not null default '[]'::jsonb;

alter table public.utility_meters add column unit_limit integer not null default 200 check (unit_limit between 1 and 10000);

create table public.meter_readings (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households(id) on delete cascade,
  meter_id uuid not null references public.utility_meters(id) on delete cascade,
  reading integer not null check (reading between 0 and 9999999),
  read_at timestamptz not null default now(),
  photo_path text,
  recorded_by uuid default auth.uid(),
  created_at timestamptz not null default now(),
  check (photo_path is null or split_part(photo_path, '/', 1) = household_id::text)
);
create index meter_readings_meter_time on public.meter_readings (meter_id, read_at desc);

alter table public.meter_readings enable row level security;

-- Everyone in the household can see and add readings; a reading can be removed by whoever added it or an admin.
create policy meter_readings_read on public.meter_readings for select to authenticated using (public.is_member(household_id));
create policy meter_readings_add on public.meter_readings for insert to authenticated
  with check (
    public.is_member(household_id)
    and recorded_by = (select auth.uid())
    and exists (select 1 from public.utility_meters m where m.id = meter_id and m.household_id = meter_readings.household_id)
  );
create policy meter_readings_remove on public.meter_readings for delete to authenticated
  using (recorded_by = (select auth.uid()) or public.is_admin(household_id));

create trigger meter_readings_audit after insert or update or delete on public.meter_readings
  for each row execute function public.tg_audit();

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('meter-photos', 'meter-photos', false, 3145728, array['image/jpeg', 'image/png', 'image/webp'])
on conflict (id) do update set public = false, file_size_limit = excluded.file_size_limit, allowed_mime_types = excluded.allowed_mime_types;

create policy meter_photos_insert on storage.objects for insert to authenticated
  with check (bucket_id = 'meter-photos' and public.is_member(public.try_uuid((storage.foldername(name))[1])));
create policy meter_photos_read on storage.objects for select to authenticated
  using (bucket_id = 'meter-photos' and public.is_member(public.try_uuid((storage.foldername(name))[1])));
create policy meter_photos_delete on storage.objects for delete to authenticated
  using (bucket_id = 'meter-photos' and (owner_id = (select auth.uid())::text or public.is_admin(public.try_uuid((storage.foldername(name))[1]))));

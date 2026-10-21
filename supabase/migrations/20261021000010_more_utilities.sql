-- WASA (water) and SNGPL (gas) alongside LESCO. SNGPL bills are uploaded because its site requires a CAPTCHA.

alter table public.utility_meters drop constraint if exists utility_meters_provider_check;
alter table public.utility_meters drop constraint if exists utility_meters_reference_no_check;
alter table public.utility_meters add constraint utility_meters_provider_check check (provider in ('lesco', 'wasa', 'sngpl'));
alter table public.utility_meters add constraint utility_meters_reference_no_check check (
  (provider = 'lesco' and reference_no ~ '^[0-9]{14}$')
  or (provider = 'sngpl' and reference_no ~ '^[0-9]{11}$')
  or (provider = 'wasa' and reference_no ~ '^[0-9]{4,15}$')
);

alter table public.utility_bills add column source text not null default 'fetched' check (source in ('fetched', 'upload'));
alter table public.utility_bills add column snapshot_mime text not null default 'text/html'
  check (snapshot_mime in ('text/html', 'image/jpeg', 'image/png', 'image/webp', 'application/pdf'));

update storage.buckets
set file_size_limit = 6291456,
    allowed_mime_types = array['text/plain', 'image/jpeg', 'image/png', 'image/webp', 'application/pdf']
where id = 'utility-bills';

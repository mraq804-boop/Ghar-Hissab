-- Run once in the Supabase SQL editor AFTER deploying to Vercel.
-- Calls the app's sync worker every 2 minutes so failed or queued Excel
-- updates are retried even when nobody is using the app.
-- Replace the two placeholders first. The secret is stored in Supabase Vault,
-- not in this file.

create extension if not exists pg_cron;
create extension if not exists pg_net;

select vault.create_secret('https://YOUR-APP.vercel.app/api/sync/run', 'sync_run_url');
select vault.create_secret('PASTE-THE-SAME-VALUE-AS-CRON_SECRET', 'sync_cron_secret');

select cron.schedule(
  'excel-sync-retry',
  '*/2 * * * *',
  $$
  select net.http_post(
    url := (select decrypted_secret from vault.decrypted_secrets where name = 'sync_run_url'),
    headers := jsonb_build_object(
      'Authorization', 'Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name = 'sync_cron_secret'),
      'Content-Type', 'application/json'
    ),
    body := '{}'::jsonb,
    timeout_milliseconds := 55000
  )
  where exists (
    select 1 from public.sync_jobs
    where (status = 'pending' and next_attempt_at <= now()) or (status = 'running' and lease_until < now())
  );
  $$
);

-- Optional housekeeping: delete screenshots that were uploaded but never attached
-- to a payment (abandoned forms), once a day.
select cron.schedule(
  'orphan-proof-cleanup',
  '17 3 * * *',
  $$
  delete from storage.objects o
  where o.bucket_id = 'payment-proofs'
    and o.created_at < now() - interval '2 days'
    and not exists (select 1 from public.payment_attachments a where a.storage_path = o.name);
  $$
);

-- To stop:  select cron.unschedule('excel-sync-retry');

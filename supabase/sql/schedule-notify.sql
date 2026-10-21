-- Run once in the Supabase SQL editor AFTER deploying to Vercel (and after migration 13).
-- Calls the app every 15 minutes to send reminders, due-date alerts and summaries,
-- and to release notifications that waited for quiet hours to end.
-- Uses the same CRON secret that schedule-sync.sql stored in Vault ('sync_cron_secret').
-- Replace the URL placeholder first.

create extension if not exists pg_cron;
create extension if not exists pg_net;

select vault.create_secret('https://YOUR-APP.vercel.app/api/notify/run', 'notify_run_url');

select cron.schedule(
  'notify-run',
  '*/15 * * * *',
  $$
  select net.http_post(
    url := (select decrypted_secret from vault.decrypted_secrets where name = 'notify_run_url'),
    headers := jsonb_build_object(
      'Authorization', 'Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name = 'sync_cron_secret'),
      'Content-Type', 'application/json'
    ),
    body := '{}'::jsonb,
    timeout_milliseconds := 55000
  );
  $$
);

-- Old notifications are kept for 90 days.
select cron.schedule(
  'notify-cleanup',
  '41 3 * * *',
  $$ delete from public.notifications where created_at < now() - interval '90 days'; $$
);

-- To stop:  select cron.unschedule('notify-run'); select cron.unschedule('notify-cleanup');

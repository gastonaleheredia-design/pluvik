-- TODO: Replace YOUR_PRODUCTION_DOMAIN and YOUR_CRON_SECRET before applying to production.

-- Remove the old schedule
DO $$
BEGIN
  PERFORM cron.unschedule('sweep-tracked-events');
EXCEPTION WHEN OTHERS THEN NULL;
END $$;

-- Re-schedule with the correct production URL and secret header.
-- Replace YOUR_PRODUCTION_DOMAIN with the actual custom domain once deployed.
-- Replace YOUR_CRON_SECRET with the value you set in the CRON_SECRET env var.
SELECT cron.schedule(
  'sweep-tracked-events',
  '*/15 * * * *',
  $$
  SELECT net.http_post(
    url := 'https://YOUR_PRODUCTION_DOMAIN/api/public/sweep-events',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-cron-secret', 'YOUR_CRON_SECRET'
    ),
    body := '{}'::jsonb
  );
  $$
);
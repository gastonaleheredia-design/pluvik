CREATE EXTENSION IF NOT EXISTS pg_cron;
CREATE EXTENSION IF NOT EXISTS pg_net;

-- Remove any prior scheduling so re-runs of this migration are idempotent.
DO $$
BEGIN
  PERFORM cron.unschedule('sweep-tracked-events');
EXCEPTION WHEN OTHERS THEN
  NULL;
END $$;

SELECT cron.schedule(
  'sweep-tracked-events',
  '*/15 * * * *',
  $$
  SELECT net.http_post(
    url := 'https://project--4fbd1268-ac3d-41fa-ac13-01a980015e90.lovable.app/api/public/sweep-events',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'apikey', 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImJpaXBhcmdkbXVpaWx3d2R4cG1vIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzgxNzI0NzcsImV4cCI6MjA5Mzc0ODQ3N30.MohFGHkZFDoIpHJ_FVrOwIoQRNUvbSiZ7qlCcR05NkQ'
    ),
    body := '{}'::jsonb
  );
  $$
);
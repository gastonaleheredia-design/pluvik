ALTER TABLE public.tracked_events
  ADD COLUMN IF NOT EXISTS last_refresh_attempt_at timestamptz;

ALTER TABLE public.tracked_events REPLICA IDENTITY FULL;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = 'tracked_events'
  ) THEN
    EXECUTE 'ALTER PUBLICATION supabase_realtime ADD TABLE public.tracked_events';
  END IF;
END $$;
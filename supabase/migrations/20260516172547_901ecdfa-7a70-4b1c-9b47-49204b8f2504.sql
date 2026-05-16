ALTER TABLE public.tracked_events
  ADD COLUMN IF NOT EXISTS next_refresh_at timestamptz,
  ADD COLUMN IF NOT EXISTS current_mode text;

CREATE INDEX IF NOT EXISTS idx_tracked_events_next_refresh
  ON public.tracked_events (next_refresh_at)
  WHERE archived_at IS NULL AND is_active = true;
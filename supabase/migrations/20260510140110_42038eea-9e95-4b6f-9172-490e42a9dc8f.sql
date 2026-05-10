ALTER TABLE public.tracked_events
  ADD COLUMN IF NOT EXISTS last_significant_change_at timestamptz,
  ADD COLUMN IF NOT EXISTS user_seen_change_at timestamptz;

CREATE INDEX IF NOT EXISTS idx_tracked_events_change_seen
  ON public.tracked_events (user_id, last_significant_change_at, user_seen_change_at);
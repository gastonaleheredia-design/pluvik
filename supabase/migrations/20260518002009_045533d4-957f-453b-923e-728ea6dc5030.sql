ALTER TABLE public.tracked_events
  ADD COLUMN IF NOT EXISTS last_notified_at timestamp with time zone;

ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS onesignal_player_id text;
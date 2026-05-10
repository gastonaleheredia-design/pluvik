ALTER TABLE public.tracked_events
  ADD COLUMN IF NOT EXISTS current_forecast_stage text,
  ADD COLUMN IF NOT EXISTS event_phrase text,
  ADD COLUMN IF NOT EXISTS resolved_lat double precision,
  ADD COLUMN IF NOT EXISTS resolved_lon double precision,
  ADD COLUMN IF NOT EXISTS resolved_address text;
ALTER TABLE public.tracked_events
ADD COLUMN IF NOT EXISTS current_climate_facts jsonb;
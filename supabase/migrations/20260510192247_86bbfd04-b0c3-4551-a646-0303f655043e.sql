ALTER TABLE public.tracked_events
  ADD COLUMN IF NOT EXISTS current_maybe_explanation jsonb;
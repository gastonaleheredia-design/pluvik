ALTER TABLE public.tracked_events
  ADD COLUMN IF NOT EXISTS outcome_recorded boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS final_forecast_verdict text,
  ADD COLUMN IF NOT EXISTS final_forecast_stage text,
  ADD COLUMN IF NOT EXISTS final_forecast_sentence text;
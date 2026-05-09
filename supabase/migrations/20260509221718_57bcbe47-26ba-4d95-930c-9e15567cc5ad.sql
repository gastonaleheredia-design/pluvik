-- 1. New lifecycle columns on tracked_events
ALTER TABLE public.tracked_events
  ADD COLUMN IF NOT EXISTS event_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS archived_at TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS idx_tracked_events_user_active
  ON public.tracked_events (user_id)
  WHERE archived_at IS NULL;

-- 2. Change-tag enum
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'forecast_change_tag') THEN
    CREATE TYPE public.forecast_change_tag AS ENUM (
      'INITIAL',
      'STAGE_PROMOTED',
      'NEW_DATA_SOURCE',
      'SIGNIFICANT_CHANGE',
      'MINOR_REFRESH',
      'RESOLVED_BENIGN',
      'CONCLUDED'
    );
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'forecast_stage') THEN
    CREATE TYPE public.forecast_stage AS ENUM (
      'climate',
      'outlook',
      'model_trend',
      'short_range',
      'live'
    );
  END IF;
END $$;

-- 3. Snapshots table
CREATE TABLE IF NOT EXISTS public.event_forecast_snapshots (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  event_id UUID NOT NULL REFERENCES public.tracked_events(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now()),
  stage public.forecast_stage NOT NULL,
  decision_label TEXT,
  chance_of_impact INTEGER,
  main_threat TEXT,
  summary TEXT,
  data_sources JSONB NOT NULL DEFAULT '[]'::jsonb,
  change_tag public.forecast_change_tag NOT NULL,
  previous_snapshot_id UUID REFERENCES public.event_forecast_snapshots(id) ON DELETE SET NULL,
  is_final BOOLEAN NOT NULL DEFAULT false
);

CREATE INDEX IF NOT EXISTS idx_snapshots_event_created
  ON public.event_forecast_snapshots (event_id, created_at DESC);

ALTER TABLE public.event_forecast_snapshots ENABLE ROW LEVEL SECURITY;

-- 4. RLS — users can CRUD snapshots only for events they own.
DROP POLICY IF EXISTS "Users can view own event snapshots"
  ON public.event_forecast_snapshots;
CREATE POLICY "Users can view own event snapshots"
  ON public.event_forecast_snapshots
  FOR SELECT
  USING (EXISTS (
    SELECT 1 FROM public.tracked_events te
    WHERE te.id = event_forecast_snapshots.event_id
      AND te.user_id = auth.uid()
  ));

DROP POLICY IF EXISTS "Users can insert own event snapshots"
  ON public.event_forecast_snapshots;
CREATE POLICY "Users can insert own event snapshots"
  ON public.event_forecast_snapshots
  FOR INSERT
  WITH CHECK (EXISTS (
    SELECT 1 FROM public.tracked_events te
    WHERE te.id = event_forecast_snapshots.event_id
      AND te.user_id = auth.uid()
  ));

DROP POLICY IF EXISTS "Users can update own event snapshots"
  ON public.event_forecast_snapshots;
CREATE POLICY "Users can update own event snapshots"
  ON public.event_forecast_snapshots
  FOR UPDATE
  USING (EXISTS (
    SELECT 1 FROM public.tracked_events te
    WHERE te.id = event_forecast_snapshots.event_id
      AND te.user_id = auth.uid()
  ));

DROP POLICY IF EXISTS "Users can delete own event snapshots"
  ON public.event_forecast_snapshots;
CREATE POLICY "Users can delete own event snapshots"
  ON public.event_forecast_snapshots
  FOR DELETE
  USING (EXISTS (
    SELECT 1 FROM public.tracked_events te
    WHERE te.id = event_forecast_snapshots.event_id
      AND te.user_id = auth.uid()
  ));

-- 5. Only one CONCLUDED (is_final) snapshot per event.
CREATE UNIQUE INDEX IF NOT EXISTS uniq_snapshot_final_per_event
  ON public.event_forecast_snapshots (event_id)
  WHERE is_final = true;
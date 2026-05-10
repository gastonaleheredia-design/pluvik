
-- Clear bad current values so the fixed pipeline can repopulate them
UPDATE public.tracked_events
SET current_verdict = NULL,
    current_percentage = NULL,
    current_summary = NULL,
    current_confidence = NULL,
    current_verdict_word = NULL,
    current_verdict_sentence = NULL,
    current_forecast_stage = NULL,
    last_checked_at = NULL
WHERE is_active = true
  AND archived_at IS NULL
  AND (current_verdict IS NULL OR upper(current_verdict) = 'UNKNOWN');

-- Remove invalid snapshots from the timeline
DELETE FROM public.event_forecast_snapshots
WHERE decision_label IS NULL
   OR upper(decision_label) = 'UNKNOWN';

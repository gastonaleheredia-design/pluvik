-- Force re-evaluation of all active tracked events with the new parser/fallback.
UPDATE public.tracked_events
SET last_checked_at = NULL
WHERE archived_at IS NULL AND is_active = true;
UPDATE public.tracked_events
SET last_checked_at = NULL
WHERE archived_at IS NULL AND is_active = true;
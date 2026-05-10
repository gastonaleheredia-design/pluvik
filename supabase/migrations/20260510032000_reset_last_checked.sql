-- Reset last_checked_at to force a fresh refresh of all active tracked events
UPDATE public.tracked_events
SET last_checked_at = now() - interval '2 hours'
WHERE archived_at IS NULL;

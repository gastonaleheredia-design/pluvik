-- Force the next refresh-events run to re-evaluate every active event by
-- resetting last_checked_at past the throttle window. Lets the user see the
-- new climate / outlook pipeline output without waiting 30 minutes.
UPDATE public.tracked_events
SET last_checked_at = now() - interval '2 hours'
WHERE archived_at IS NULL AND is_active = true;
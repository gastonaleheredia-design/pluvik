-- 1. Drop the blocking unique index
DROP INDEX IF EXISTS public.uniq_snapshot_final_per_event;

-- 2. Replace with a non-blocking check trigger that warns but never blocks writes
CREATE OR REPLACE FUNCTION public.warn_duplicate_final_snapshot()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  existing_count integer;
BEGIN
  IF NEW.is_final = true THEN
    SELECT COUNT(*) INTO existing_count
    FROM public.event_forecast_snapshots
    WHERE event_id = NEW.event_id AND is_final = true AND id != NEW.id;
    IF existing_count > 0 THEN
      RAISE WARNING 'Multiple is_final=true snapshots for event_id %', NEW.event_id;
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS check_duplicate_final_snapshot ON public.event_forecast_snapshots;
CREATE TRIGGER check_duplicate_final_snapshot
BEFORE INSERT OR UPDATE ON public.event_forecast_snapshots
FOR EACH ROW EXECUTE PROCEDURE public.warn_duplicate_final_snapshot();

-- 3. Admin RPC to reset a premature CONCLUDED snapshot (callable from Supabase dashboard)
CREATE OR REPLACE FUNCTION public.admin_reset_final_snapshot(p_event_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  UPDATE public.event_forecast_snapshots
  SET is_final = false
  WHERE event_id = p_event_id AND is_final = true;
END;
$$;

-- Restrict to service role only — never callable by anon or authenticated users
REVOKE EXECUTE ON FUNCTION public.admin_reset_final_snapshot(uuid) FROM public, anon, authenticated;
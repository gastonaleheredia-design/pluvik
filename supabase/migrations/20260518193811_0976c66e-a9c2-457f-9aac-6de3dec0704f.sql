CREATE TABLE IF NOT EXISTS public.api_call_counters (
  key text PRIMARY KEY,
  count integer NOT NULL DEFAULT 0,
  reset_at date NOT NULL DEFAULT CURRENT_DATE
);

INSERT INTO public.api_call_counters (key, count, reset_at)
VALUES ('tomorrow_io_daily', 0, CURRENT_DATE)
ON CONFLICT (key) DO NOTHING;

ALTER TABLE public.api_call_counters ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "service role only" ON public.api_call_counters;
CREATE POLICY "service role only" ON public.api_call_counters
  FOR ALL
  USING (false)
  WITH CHECK (false);

CREATE OR REPLACE FUNCTION public.increment_api_counter(
  p_key text,
  p_today date,
  p_budget integer
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO public.api_call_counters (key, count, reset_at)
  VALUES (p_key, 1, p_today)
  ON CONFLICT (key) DO UPDATE
    SET
      count = CASE
        WHEN api_call_counters.reset_at < p_today THEN 1
        ELSE api_call_counters.count + 1
      END,
      reset_at = p_today
  WHERE
    (api_call_counters.reset_at < p_today OR api_call_counters.count < p_budget);
END;
$$;

REVOKE EXECUTE ON FUNCTION public.increment_api_counter(text, date, integer) FROM public, anon, authenticated;
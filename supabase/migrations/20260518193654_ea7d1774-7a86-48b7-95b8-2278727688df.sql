ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS preferred_briefing_hour integer
    NOT NULL DEFAULT 7
    CHECK (preferred_briefing_hour >= 5 AND preferred_briefing_hour <= 11);

COMMENT ON COLUMN public.profiles.preferred_briefing_hour IS
  'Local hour (5–11) at which the user wants their morning briefing. Default 7 = 7am.';
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS monthly_question_count integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS question_count_reset_at date NOT NULL DEFAULT CURRENT_DATE;
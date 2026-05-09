ALTER TABLE public.tracked_events
  ADD COLUMN IF NOT EXISTS current_verdict_word text,
  ADD COLUMN IF NOT EXISTS current_verdict_sentence text;

ALTER TABLE public.journal_entries
  ADD COLUMN IF NOT EXISTS verdict_word text,
  ADD COLUMN IF NOT EXISTS verdict_sentence text;
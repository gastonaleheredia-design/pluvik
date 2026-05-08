ALTER TABLE public.profiles
ADD COLUMN IF NOT EXISTS onboarding_completed_at timestamp with time zone;
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO public.profiles (id) VALUES (new.id)
    ON CONFLICT (id) DO NOTHING;

  INSERT INTO public.user_profiles (id, username, daily_question_count, tier)
  VALUES (
    new.id,
    'user_' || left(new.id::text, 8),
    0,
    'free'
  )
  ON CONFLICT (id) DO NOTHING;

  RETURN new;
END;
$$;

-- Backfill missing user_profiles rows for existing auth users
INSERT INTO public.user_profiles (id, username, daily_question_count, tier)
SELECT u.id, 'user_' || left(u.id::text, 8), 0, 'free'
FROM auth.users u
LEFT JOIN public.user_profiles up ON up.id = u.id
WHERE up.id IS NULL
ON CONFLICT (id) DO NOTHING;
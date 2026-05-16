CREATE OR REPLACE FUNCTION public.get_user_tier(user_id uuid)
RETURNS text
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT CASE
    WHEN auth.uid() IS NULL OR auth.uid() <> get_user_tier.user_id THEN NULL
    ELSE COALESCE(
      (
        SELECT s.tier
        FROM public.subscriptions s
        WHERE s.user_id = get_user_tier.user_id
          AND s.status = 'active'
        ORDER BY s.current_period_end DESC NULLS LAST, s.created_at DESC
        LIMIT 1
      ),
      (SELECT p.subscription_tier FROM public.profiles p WHERE p.id = get_user_tier.user_id),
      'free'
    )
  END;
$$;

REVOKE EXECUTE ON FUNCTION public.get_user_tier(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_user_tier(uuid) TO authenticated;
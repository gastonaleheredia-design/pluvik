
CREATE OR REPLACE FUNCTION public.get_team_tracked_events()
RETURNS TABLE (
  id uuid,
  user_id uuid,
  asker_email text,
  question text,
  resolved_address text,
  address text,
  event_at timestamptz,
  created_at timestamptz,
  current_verdict_word text,
  current_verdict_sentence text,
  current_forecast_stage text,
  is_active boolean,
  archived_at timestamptz,
  business_id uuid,
  business_name text
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, auth
AS $$
  WITH my_biz AS (
    SELECT bp.id AS business_id, bp.business_name
    FROM public.business_profiles bp
    WHERE bp.owner_user_id = auth.uid()
    UNION
    SELECT bp.id, bp.business_name
    FROM public.team_members tm
    JOIN public.business_profiles bp ON bp.id = tm.business_id
    WHERE tm.user_id = auth.uid() AND tm.accepted_at IS NOT NULL
  ),
  member_users AS (
    SELECT mb.business_id, mb.business_name, bp.owner_user_id AS member_user_id
    FROM my_biz mb
    JOIN public.business_profiles bp ON bp.id = mb.business_id
    UNION
    SELECT mb.business_id, mb.business_name, tm.user_id
    FROM my_biz mb
    JOIN public.team_members tm ON tm.business_id = mb.business_id
    WHERE tm.user_id IS NOT NULL AND tm.accepted_at IS NOT NULL
  )
  SELECT te.id,
         te.user_id,
         u.email::text AS asker_email,
         te.question,
         te.resolved_address,
         te.address,
         te.event_at,
         te.created_at,
         te.current_verdict_word,
         te.current_verdict_sentence,
         te.current_forecast_stage,
         te.is_active,
         te.archived_at,
         mu.business_id,
         mu.business_name
  FROM public.tracked_events te
  JOIN member_users mu ON mu.member_user_id = te.user_id
  LEFT JOIN auth.users u ON u.id = te.user_id;
$$;

REVOKE EXECUTE ON FUNCTION public.get_team_tracked_events() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_team_tracked_events() TO authenticated;

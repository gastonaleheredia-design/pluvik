
-- USER PROFILES
CREATE TABLE public.user_profiles (
  id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  username text UNIQUE NOT NULL,
  display_name text,
  bio text,
  avatar_url text,
  tier text NOT NULL DEFAULT 'free',
  daily_question_count integer NOT NULL DEFAULT 0,
  last_question_date date,
  created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.user_profiles ENABLE ROW LEVEL SECURITY;
CREATE POLICY "user_profiles readable by anyone" ON public.user_profiles FOR SELECT USING (true);
CREATE POLICY "users insert own profile" ON public.user_profiles FOR INSERT WITH CHECK (auth.uid() = id);
CREATE POLICY "users update own profile" ON public.user_profiles FOR UPDATE USING (auth.uid() = id);
CREATE POLICY "users delete own profile" ON public.user_profiles FOR DELETE USING (auth.uid() = id);

-- COMPANY PROFILES
CREATE TABLE public.company_profiles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  company_name text NOT NULL,
  industry text,
  logo_url text,
  created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.company_profiles ENABLE ROW LEVEL SECURITY;

-- COMPANY TEAMS
CREATE TABLE public.company_teams (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES public.company_profiles(id) ON DELETE CASCADE,
  name text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.company_teams ENABLE ROW LEVEL SECURITY;

-- COMPANY MEMBERS
CREATE TABLE public.company_members (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES public.company_profiles(id) ON DELETE CASCADE,
  user_id uuid REFERENCES auth.users(id) ON DELETE CASCADE,
  team_id uuid REFERENCES public.company_teams(id) ON DELETE SET NULL,
  role text NOT NULL DEFAULT 'member',
  invited_email text,
  accepted_at timestamptz
);
ALTER TABLE public.company_members ENABLE ROW LEVEL SECURITY;

-- Helper functions (SECURITY DEFINER to avoid recursive RLS)
CREATE OR REPLACE FUNCTION public.is_company_member(_company_id uuid, _user_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.company_members
    WHERE company_id = _company_id AND user_id = _user_id AND accepted_at IS NOT NULL
  ) OR EXISTS (
    SELECT 1 FROM public.company_profiles
    WHERE id = _company_id AND owner_user_id = _user_id
  );
$$;

CREATE OR REPLACE FUNCTION public.is_company_admin(_company_id uuid, _user_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.company_profiles
    WHERE id = _company_id AND owner_user_id = _user_id
  ) OR EXISTS (
    SELECT 1 FROM public.company_members
    WHERE company_id = _company_id AND user_id = _user_id
      AND role IN ('owner','admin') AND accepted_at IS NOT NULL
  );
$$;

-- company_profiles policies
CREATE POLICY "Members view company" ON public.company_profiles FOR SELECT
  USING (public.is_company_member(id, auth.uid()));
CREATE POLICY "Owner manages company" ON public.company_profiles FOR ALL
  USING (auth.uid() = owner_user_id) WITH CHECK (auth.uid() = owner_user_id);

-- company_teams policies
CREATE POLICY "Members view teams" ON public.company_teams FOR SELECT
  USING (public.is_company_member(company_id, auth.uid()));
CREATE POLICY "Admins manage teams" ON public.company_teams FOR ALL
  USING (public.is_company_admin(company_id, auth.uid()))
  WITH CHECK (public.is_company_admin(company_id, auth.uid()));

-- company_members policies
CREATE POLICY "Members view fellow members" ON public.company_members FOR SELECT
  USING (public.is_company_member(company_id, auth.uid()) OR user_id = auth.uid());
CREATE POLICY "Admins manage members" ON public.company_members FOR ALL
  USING (public.is_company_admin(company_id, auth.uid()))
  WITH CHECK (public.is_company_admin(company_id, auth.uid()));

-- WEATHER EVENTS
CREATE TABLE public.weather_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  creator_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  company_id uuid REFERENCES public.company_profiles(id) ON DELETE SET NULL,
  team_ids uuid[],
  title text,
  question text,
  location_label text,
  lat double precision,
  lon double precision,
  activity_type text,
  event_date timestamptz,
  verdict text,
  confidence text,
  forecast_stage text,
  status text NOT NULL DEFAULT 'active',
  status_message text,
  status_set_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.weather_events ENABLE ROW LEVEL SECURITY;

-- EVENT PARTICIPANTS
CREATE TABLE public.event_participants (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id uuid NOT NULL REFERENCES public.weather_events(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  role text NOT NULL DEFAULT 'participant',
  is_anonymous boolean NOT NULL DEFAULT false,
  joined_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (event_id, user_id)
);
ALTER TABLE public.event_participants ENABLE ROW LEVEL SECURITY;

-- Helper: is event participant
CREATE OR REPLACE FUNCTION public.is_event_participant(_event_id uuid, _user_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.event_participants
    WHERE event_id = _event_id AND user_id = _user_id
  ) OR EXISTS (
    SELECT 1 FROM public.weather_events
    WHERE id = _event_id AND creator_id = _user_id
  );
$$;

-- weather_events policies
CREATE POLICY "Participants view events" ON public.weather_events FOR SELECT
  USING (public.is_event_participant(id, auth.uid()));
CREATE POLICY "Creator inserts event" ON public.weather_events FOR INSERT
  WITH CHECK (auth.uid() = creator_id);
CREATE POLICY "Creator updates event" ON public.weather_events FOR UPDATE
  USING (auth.uid() = creator_id);
CREATE POLICY "Creator deletes event" ON public.weather_events FOR DELETE
  USING (auth.uid() = creator_id);

-- event_participants policies
CREATE POLICY "Participants view participants" ON public.event_participants FOR SELECT
  USING (public.is_event_participant(event_id, auth.uid()));
CREATE POLICY "User joins self or creator adds" ON public.event_participants FOR INSERT
  WITH CHECK (
    auth.uid() = user_id
    OR EXISTS (SELECT 1 FROM public.weather_events WHERE id = event_id AND creator_id = auth.uid())
  );
CREATE POLICY "User updates own participation" ON public.event_participants FOR UPDATE
  USING (
    auth.uid() = user_id
    OR EXISTS (SELECT 1 FROM public.weather_events WHERE id = event_id AND creator_id = auth.uid())
  );
CREATE POLICY "User leaves or creator removes" ON public.event_participants FOR DELETE
  USING (
    auth.uid() = user_id
    OR EXISTS (SELECT 1 FROM public.weather_events WHERE id = event_id AND creator_id = auth.uid())
  );

-- EVENT COMMENTS
CREATE TABLE public.event_comments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id uuid NOT NULL REFERENCES public.weather_events(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  text text NOT NULL,
  is_anonymous boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.event_comments ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Participants view comments" ON public.event_comments FOR SELECT
  USING (public.is_event_participant(event_id, auth.uid()));
CREATE POLICY "Participants insert comments" ON public.event_comments FOR INSERT
  WITH CHECK (auth.uid() = user_id AND public.is_event_participant(event_id, auth.uid()));
CREATE POLICY "Author updates own comment" ON public.event_comments FOR UPDATE
  USING (auth.uid() = user_id);
CREATE POLICY "Author deletes own comment" ON public.event_comments FOR DELETE
  USING (auth.uid() = user_id);

-- FOLLOWS
CREATE TABLE public.follows (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  follower_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  following_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (follower_id, following_id)
);
ALTER TABLE public.follows ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Follower or followed views" ON public.follows FOR SELECT
  USING (auth.uid() = follower_id OR auth.uid() = following_id);
CREATE POLICY "Follower inserts" ON public.follows FOR INSERT
  WITH CHECK (auth.uid() = follower_id);
CREATE POLICY "Follower deletes" ON public.follows FOR DELETE
  USING (auth.uid() = follower_id);

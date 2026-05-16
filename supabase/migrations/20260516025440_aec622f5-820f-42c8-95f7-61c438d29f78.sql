
-- business_profiles
CREATE TABLE public.business_profiles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  business_name text NOT NULL,
  industry text NOT NULL CHECK (industry IN ('construction','events','marine','sports','agriculture','other')),
  created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.business_profiles ENABLE ROW LEVEL SECURITY;

-- team_members
CREATE TABLE public.team_members (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id uuid NOT NULL REFERENCES public.business_profiles(id) ON DELETE CASCADE,
  user_id uuid REFERENCES auth.users(id) ON DELETE CASCADE,
  role text NOT NULL DEFAULT 'member' CHECK (role IN ('owner','member')),
  invited_email text,
  accepted_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.team_members ENABLE ROW LEVEL SECURITY;

CREATE INDEX idx_team_members_business ON public.team_members(business_id);
CREATE INDEX idx_team_members_user ON public.team_members(user_id);

-- Security definer to check ownership without recursion
CREATE OR REPLACE FUNCTION public.is_business_owner(_business_id uuid, _user_id uuid)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.business_profiles
    WHERE id = _business_id AND owner_user_id = _user_id
  );
$$;

CREATE OR REPLACE FUNCTION public.is_business_member(_business_id uuid, _user_id uuid)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.team_members
    WHERE business_id = _business_id AND user_id = _user_id
  );
$$;

-- business_profiles policies
CREATE POLICY "Owners manage own business" ON public.business_profiles
  FOR ALL USING (auth.uid() = owner_user_id) WITH CHECK (auth.uid() = owner_user_id);

CREATE POLICY "Members view business" ON public.business_profiles
  FOR SELECT USING (public.is_business_member(id, auth.uid()));

-- team_members policies
CREATE POLICY "Owners manage team" ON public.team_members
  FOR ALL USING (public.is_business_owner(business_id, auth.uid()))
  WITH CHECK (public.is_business_owner(business_id, auth.uid()));

CREATE POLICY "Members view own membership" ON public.team_members
  FOR SELECT USING (auth.uid() = user_id);

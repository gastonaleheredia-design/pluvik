CREATE OR REPLACE FUNCTION public.sync_user_profiles_tier()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  UPDATE public.user_profiles
  SET tier = NEW.subscription_tier
  WHERE id = NEW.id;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS on_profiles_tier_change ON public.profiles;
CREATE TRIGGER on_profiles_tier_change
AFTER UPDATE OF subscription_tier ON public.profiles
FOR EACH ROW
WHEN (OLD.subscription_tier IS DISTINCT FROM NEW.subscription_tier)
EXECUTE PROCEDURE public.sync_user_profiles_tier();
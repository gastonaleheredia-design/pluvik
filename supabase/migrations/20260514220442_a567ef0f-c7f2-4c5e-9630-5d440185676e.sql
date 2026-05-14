-- Add FKs with cascade (drop first if they already exist under a different name)
ALTER TABLE public.user_notifications
  DROP CONSTRAINT IF EXISTS user_notifications_user_id_fkey,
  DROP CONSTRAINT IF EXISTS user_notifications_event_id_fkey;

ALTER TABLE public.user_notifications
  ADD CONSTRAINT user_notifications_user_id_fkey
    FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE,
  ADD CONSTRAINT user_notifications_event_id_fkey
    FOREIGN KEY (event_id) REFERENCES public.tracked_events(id) ON DELETE CASCADE;

-- Loosen NOT NULL on optional fields
ALTER TABLE public.user_notifications
  ALTER COLUMN event_id DROP NOT NULL,
  ALTER COLUMN change_tag DROP NOT NULL,
  ALTER COLUMN stage DROP NOT NULL;

-- Index for fast per-user unread queries
CREATE INDEX IF NOT EXISTS user_notifications_user_unread
  ON public.user_notifications(user_id, read, created_at DESC);

-- Consolidate to a single ALL policy
DROP POLICY IF EXISTS "Users can view own notifications" ON public.user_notifications;
DROP POLICY IF EXISTS "Users can insert own notifications" ON public.user_notifications;
DROP POLICY IF EXISTS "Users can update own notifications" ON public.user_notifications;
DROP POLICY IF EXISTS "Users can delete own notifications" ON public.user_notifications;
DROP POLICY IF EXISTS "users_own_notifications" ON public.user_notifications;

CREATE POLICY "users_own_notifications" ON public.user_notifications
  FOR ALL
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);
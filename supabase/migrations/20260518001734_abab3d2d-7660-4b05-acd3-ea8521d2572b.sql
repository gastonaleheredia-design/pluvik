CREATE TABLE public.answer_feedback (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  event_question text,
  address text,
  verdict text,
  percentage integer,
  lat double precision,
  lon double precision,
  feedback text NOT NULL,
  user_id uuid,
  created_at timestamp with time zone NOT NULL DEFAULT now()
);

ALTER TABLE public.answer_feedback ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Anyone can submit feedback"
ON public.answer_feedback
FOR INSERT
TO anon, authenticated
WITH CHECK (true);
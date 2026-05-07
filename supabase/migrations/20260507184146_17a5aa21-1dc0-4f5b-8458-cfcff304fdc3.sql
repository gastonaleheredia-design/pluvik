create extension if not exists "uuid-ossp";

create table public.profiles (
  id uuid references auth.users on delete cascade primary key,
  language text default 'en',
  notification_sensitivity text default 'medium',
  quiet_hours_start integer default 22,
  quiet_hours_end integer default 7,
  created_at timestamp with time zone default timezone('utc', now())
);

create table public.saved_places (
  id uuid default uuid_generate_v4() primary key,
  user_id uuid references public.profiles(id) on delete cascade not null,
  nickname text not null,
  address text not null,
  lat double precision not null,
  lon double precision not null,
  emoji text default '📍',
  created_at timestamp with time zone default timezone('utc', now())
);

create table public.tracked_events (
  id uuid default uuid_generate_v4() primary key,
  user_id uuid references public.profiles(id) on delete cascade not null,
  question text not null,
  address text not null,
  lat double precision,
  lon double precision,
  current_verdict text,
  current_percentage integer,
  current_summary text,
  current_confidence text,
  last_checked_at timestamp with time zone default timezone('utc', now()),
  created_at timestamp with time zone default timezone('utc', now()),
  is_active boolean default true
);

create table public.journal_entries (
  id uuid default uuid_generate_v4() primary key,
  event_id uuid references public.tracked_events(id) on delete cascade not null,
  user_id uuid references public.profiles(id) on delete cascade not null,
  verdict text,
  percentage integer,
  summary text,
  confidence text,
  current_conditions text,
  checked_at timestamp with time zone default timezone('utc', now())
);

alter table public.profiles enable row level security;
alter table public.saved_places enable row level security;
alter table public.tracked_events enable row level security;
alter table public.journal_entries enable row level security;

create policy "Users can manage own profile"
  on public.profiles for all using (auth.uid() = id);

create policy "Users can manage own places"
  on public.saved_places for all using (auth.uid() = user_id);

create policy "Users can manage own events"
  on public.tracked_events for all using (auth.uid() = user_id);

create policy "Users can manage own journal"
  on public.journal_entries for all using (auth.uid() = user_id);

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id) values (new.id);
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute procedure public.handle_new_user();
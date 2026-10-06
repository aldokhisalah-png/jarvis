-- Jarvis: its own tables only. Nothing here touches Uni Planner, PPL Coach or Nutrition Coach tables.
-- (day_settings, day_plans, jarvis_push_subs, jarvis_sent and jarvis_reports already exist from the first Jarvis.)

-- What Salah tells Jarvis to remember, in levels:
--   goal  → a big-picture outcome; track = how Jarvis measures it ('body', 'grades'), target = the numbers
--   habit → a small-picture goal he set to reach big goals; serves = goal ids; track = how Jarvis measures it
--   rule  → an approximate rule or preference (how long things take, when he likes to do them); serves = goal ids (optional)
--   habits and rules: strength 'must' (a requirement) or 'prefer' (when possible)
--   day   → a change for one date; overrides = times the planner must keep that day (gymAt, wake, sleep, lunchAt, dinnerAt)
create table if not exists public.jarvis_memory (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  kind text not null check (kind in ('goal', 'habit', 'rule', 'day')),
  strength text check (strength in ('must', 'prefer')),
  text text not null check (length(text) between 1 and 500),
  serves text[] not null default '{}',
  category text,
  course text,
  qid text,                                  -- the questionnaire question that saved it (re-answering replaces it)
  track text,
  target jsonb,
  date date,
  overrides jsonb not null default '{}'::jsonb,
  active boolean not null default true,
  source text not null default 'chat' check (source in ('chat', 'app', 'setup')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint jarvis_memory_shape check (
    (kind in ('rule', 'habit') and strength is not null and date is null) or
    (kind = 'goal' and date is null) or
    (kind = 'day' and date is not null)
  )
);
create index if not exists jarvis_memory_user_idx on public.jarvis_memory (user_id, kind, date);
alter table public.jarvis_memory enable row level security;
drop policy if exists "own jarvis_memory" on public.jarvis_memory;
create policy "own jarvis_memory" on public.jarvis_memory for all to authenticated
  using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);

-- The conversation with Jarvis (weekly reports are messages of kind 'report' with the report in data).
create table if not exists public.jarvis_messages (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  role text not null check (role in ('user', 'jarvis')),
  kind text,
  title text,
  body text not null default '',
  data jsonb,
  created_at timestamptz not null default now()
);
create index if not exists jarvis_messages_user_idx on public.jarvis_messages (user_id, created_at desc);
alter table public.jarvis_messages enable row level security;
drop policy if exists "own jarvis_messages" on public.jarvis_messages;
create policy "own jarvis_messages" on public.jarvis_messages for all to authenticated
  using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);

-- Jarvis's analysis of each app, kept as history so it can say how things changed.
create table if not exists public.jarvis_reviews (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  app text not null check (app in ('ppl', 'nutrition', 'uni')),
  review jsonb not null,
  stats jsonb,
  created_at timestamptz not null default now()
);
create index if not exists jarvis_reviews_user_idx on public.jarvis_reviews (user_id, created_at desc);
alter table public.jarvis_reviews enable row level security;
drop policy if exists "own jarvis_reviews" on public.jarvis_reviews;
create policy "own jarvis_reviews" on public.jarvis_reviews for all to authenticated
  using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);

-- Marks he tells Jarvis (Uni Planner has weights but no scores), so Jarvis can see where each course stands.
create table if not exists public.jarvis_marks (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  event_id text,
  course text not null check (length(course) between 1 and 40),
  title text not null check (length(title) between 1 and 200),
  weight numeric,
  score numeric not null check (score >= 0),
  out_of numeric not null check (out_of > 0),
  note text,
  created_at timestamptz not null default now()
);
create index if not exists jarvis_marks_user_idx on public.jarvis_marks (user_id, course);
alter table public.jarvis_marks enable row level security;
drop policy if exists "own jarvis_marks" on public.jarvis_marks;
create policy "own jarvis_marks" on public.jarvis_marks for all to authenticated
  using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);

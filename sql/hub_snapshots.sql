-- Compact hub payloads written at refresh time. The full board tables stay
-- the source for the board, the slip, and player logs. Service role reads
-- these from /api/data; anon and authenticated have no grant.
--
-- Apply in the Supabase SQL editor. A missing table is skipped by publish.

begin;

create table if not exists public.kbo_hub (
  id bigint primary key,
  data jsonb not null,
  updated_at timestamptz not null default now()
);
create table if not exists public.nfl_hub (
  id bigint primary key,
  data jsonb not null,
  updated_at timestamptz not null default now()
);
create table if not exists public.nhl_hub (
  id bigint primary key,
  data jsonb not null,
  updated_at timestamptz not null default now()
);
create table if not exists public.wnba_hub (
  id bigint primary key,
  data jsonb not null,
  updated_at timestamptz not null default now()
);
create table if not exists public.nba_hub (
  id bigint primary key,
  data jsonb not null,
  updated_at timestamptz not null default now()
);

alter table public.kbo_hub enable row level security;
alter table public.nfl_hub enable row level security;
alter table public.nhl_hub enable row level security;
alter table public.wnba_hub enable row level security;
alter table public.nba_hub enable row level security;

revoke all on public.kbo_hub from anon, authenticated;
revoke all on public.nfl_hub from anon, authenticated;
revoke all on public.nhl_hub from anon, authenticated;
revoke all on public.wnba_hub from anon, authenticated;
revoke all on public.nba_hub from anon, authenticated;

commit;

-- NHL PrizePicks board, lineups, and Unabated odds. Run this in the Supabase
-- SQL editor before the first nhl/ publish. The repo does not apply it, and
-- it does not turn on nhl_public.
--
-- After the tables exist, publish with:
--   PUBLISH_ONLY_PREFIX=nhl/ python publish_supabase.py

begin;

create table if not exists public.nhl_projections (
  id bigint primary key,
  data jsonb not null,
  updated_at timestamptz not null default now()
);

create table if not exists public.nhl_lineups (
  id bigint primary key,
  data jsonb not null,
  updated_at timestamptz not null default now()
);

create table if not exists public.nhl_sharp_odds (
  id bigint primary key,
  data jsonb not null,
  updated_at timestamptz not null default now()
);

alter table public.nhl_projections enable row level security;
alter table public.nhl_lineups enable row level security;
alter table public.nhl_sharp_odds enable row level security;

revoke all on public.nhl_projections from anon, authenticated;
revoke all on public.nhl_lineups from anon, authenticated;
revoke all on public.nhl_sharp_odds from anon, authenticated;

commit;

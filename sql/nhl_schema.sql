-- NHL PrizePicks board, lineups, and Unabated odds. Run this in the Supabase
-- SQL editor before the first nhl/ publish. The repo does not apply it, and
-- it does not turn on nhl_public. That flag does not grant NHL access.
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

-- Defense vs position. The same statements are in sql/nhl_dvp.sql for a
-- database that already has the three tables above.
create table if not exists public.nhl_dvp_f (
  id bigint primary key,
  data jsonb not null,
  updated_at timestamptz not null default now()
);

create table if not exists public.nhl_dvp_d (
  id bigint primary key,
  data jsonb not null,
  updated_at timestamptz not null default now()
);

create table if not exists public.nhl_dvp_g (
  id bigint primary key,
  data jsonb not null,
  updated_at timestamptz not null default now()
);

alter table public.nhl_projections enable row level security;
alter table public.nhl_lineups enable row level security;
alter table public.nhl_sharp_odds enable row level security;
alter table public.nhl_dvp_f enable row level security;
alter table public.nhl_dvp_d enable row level security;
alter table public.nhl_dvp_g enable row level security;

revoke all on public.nhl_projections from anon, authenticated;
revoke all on public.nhl_lineups from anon, authenticated;
revoke all on public.nhl_sharp_odds from anon, authenticated;
revoke all on public.nhl_dvp_f from anon, authenticated;
revoke all on public.nhl_dvp_d from anon, authenticated;
revoke all on public.nhl_dvp_g from anon, authenticated;

commit;

-- NBA roster, team, and five-position DVP snapshots. Run this in the Supabase
-- SQL editor (project ocaqjkfdjqxszevtllew) before the first `nba/` publish,
-- and re-run it before publishing DVP if the five nba_dvp_* tables are not
-- there yet.
--
-- Safe to re-run. It does not turn on nba_public, does not grant anon or
-- authenticated access, and does not drop existing rows. The repo does not
-- apply it.
--
-- After the tables exist, publish with:
--   PUBLISH_ONLY_PREFIX=nba/ python publish_supabase.py
-- The site keeps returning 403 for everyone except full NBA access, and 404
-- for an allowed caller until that publish has written id = 1.

begin;

create table if not exists public.nba_players (
  id bigint primary key,
  data jsonb not null,
  updated_at timestamptz not null default now()
);

create table if not exists public.nba_teams (
  id bigint primary key,
  data jsonb not null,
  updated_at timestamptz not null default now()
);

create table if not exists public.nba_dvp_pg (
  id bigint primary key,
  data jsonb not null,
  updated_at timestamptz not null default now()
);

create table if not exists public.nba_dvp_sg (
  id bigint primary key,
  data jsonb not null,
  updated_at timestamptz not null default now()
);

create table if not exists public.nba_dvp_sf (
  id bigint primary key,
  data jsonb not null,
  updated_at timestamptz not null default now()
);

create table if not exists public.nba_dvp_pf (
  id bigint primary key,
  data jsonb not null,
  updated_at timestamptz not null default now()
);

create table if not exists public.nba_dvp_c (
  id bigint primary key,
  data jsonb not null,
  updated_at timestamptz not null default now()
);

create or replace function set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists nba_players_set_updated_at on public.nba_players;
create trigger nba_players_set_updated_at
before update on public.nba_players
for each row execute function set_updated_at();

drop trigger if exists nba_teams_set_updated_at on public.nba_teams;
create trigger nba_teams_set_updated_at
before update on public.nba_teams
for each row execute function set_updated_at();

drop trigger if exists nba_dvp_pg_set_updated_at on public.nba_dvp_pg;
create trigger nba_dvp_pg_set_updated_at
before update on public.nba_dvp_pg
for each row execute function set_updated_at();

drop trigger if exists nba_dvp_sg_set_updated_at on public.nba_dvp_sg;
create trigger nba_dvp_sg_set_updated_at
before update on public.nba_dvp_sg
for each row execute function set_updated_at();

drop trigger if exists nba_dvp_sf_set_updated_at on public.nba_dvp_sf;
create trigger nba_dvp_sf_set_updated_at
before update on public.nba_dvp_sf
for each row execute function set_updated_at();

drop trigger if exists nba_dvp_pf_set_updated_at on public.nba_dvp_pf;
create trigger nba_dvp_pf_set_updated_at
before update on public.nba_dvp_pf
for each row execute function set_updated_at();

drop trigger if exists nba_dvp_c_set_updated_at on public.nba_dvp_c;
create trigger nba_dvp_c_set_updated_at
before update on public.nba_dvp_c
for each row execute function set_updated_at();

alter table public.nba_players enable row level security;
alter table public.nba_teams enable row level security;
alter table public.nba_dvp_pg enable row level security;
alter table public.nba_dvp_sg enable row level security;
alter table public.nba_dvp_sf enable row level security;
alter table public.nba_dvp_pf enable row level security;
alter table public.nba_dvp_c enable row level security;

revoke all on public.nba_players from anon, authenticated;
revoke all on public.nba_teams from anon, authenticated;
revoke all on public.nba_dvp_pg from anon, authenticated;
revoke all on public.nba_dvp_sg from anon, authenticated;
revoke all on public.nba_dvp_sf from anon, authenticated;
revoke all on public.nba_dvp_pf from anon, authenticated;
revoke all on public.nba_dvp_c from anon, authenticated;

commit;

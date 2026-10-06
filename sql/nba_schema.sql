-- NBA roster and team snapshots. Run this once in the Supabase SQL editor
-- (project ocaqjkfdjqxszevtllew) before the first `nba/` publish.
--
-- Safe to run before or after the Phase 2 PR merges. It does not turn on
-- nba_public and it does not grant anon or authenticated access. Re-running
-- it does not drop data. The repo does not apply it.
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

alter table public.nba_players enable row level security;
alter table public.nba_teams enable row level security;

revoke all on public.nba_players from anon, authenticated;
revoke all on public.nba_teams from anon, authenticated;

commit;

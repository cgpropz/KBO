-- WNBA snapshot tables for the merged cgpropz site.
-- Run this once in the Supabase SQL Editor (project ocaqjkfdjqxszevtllew).
-- Idempotent: safe to re-run. Mirrors the KBO blob pattern (one jsonb row id=1
-- per dataset, written with the service role key, read publicly via anon key).
--
-- After running this, publish snapshots with:
--   SUPABASE_SERVICE_ROLE_KEY=... python publish_supabase.py

create table if not exists wnba_projections_standard (
  id bigint primary key,
  data jsonb not null,
  updated_at timestamptz not null default now()
);

create table if not exists wnba_projections_demon (
  id bigint primary key,
  data jsonb not null,
  updated_at timestamptz not null default now()
);

create table if not exists wnba_projections_goblin (
  id bigint primary key,
  data jsonb not null,
  updated_at timestamptz not null default now()
);

create table if not exists wnba_players (
  id bigint primary key,
  data jsonb not null,
  updated_at timestamptz not null default now()
);

create table if not exists wnba_teams (
  id bigint primary key,
  data jsonb not null,
  updated_at timestamptz not null default now()
);

create table if not exists wnba_lineups (
  id bigint primary key,
  data jsonb not null,
  updated_at timestamptz not null default now()
);

-- Reuse set_updated_at() from supabase_schema.sql; define it here too so this
-- file is standalone-runnable.
create or replace function set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists wnba_projections_standard_set_updated_at on wnba_projections_standard;
create trigger wnba_projections_standard_set_updated_at
before update on wnba_projections_standard
for each row execute function set_updated_at();

drop trigger if exists wnba_projections_demon_set_updated_at on wnba_projections_demon;
create trigger wnba_projections_demon_set_updated_at
before update on wnba_projections_demon
for each row execute function set_updated_at();

drop trigger if exists wnba_projections_goblin_set_updated_at on wnba_projections_goblin;
create trigger wnba_projections_goblin_set_updated_at
before update on wnba_projections_goblin
for each row execute function set_updated_at();

drop trigger if exists wnba_players_set_updated_at on wnba_players;
create trigger wnba_players_set_updated_at
before update on wnba_players
for each row execute function set_updated_at();

drop trigger if exists wnba_teams_set_updated_at on wnba_teams;
create trigger wnba_teams_set_updated_at
before update on wnba_teams
for each row execute function set_updated_at();

drop trigger if exists wnba_lineups_set_updated_at on wnba_lineups;
create trigger wnba_lineups_set_updated_at
before update on wnba_lineups
for each row execute function set_updated_at();

alter table wnba_projections_standard enable row level security;
alter table wnba_projections_demon enable row level security;
alter table wnba_projections_goblin enable row level security;
alter table wnba_players enable row level security;
alter table wnba_teams enable row level security;
alter table wnba_lineups enable row level security;

drop policy if exists wnba_projections_standard_read_all on wnba_projections_standard;
create policy wnba_projections_standard_read_all
on wnba_projections_standard for select
using (true);

drop policy if exists wnba_projections_demon_read_all on wnba_projections_demon;
create policy wnba_projections_demon_read_all
on wnba_projections_demon for select
using (true);

drop policy if exists wnba_projections_goblin_read_all on wnba_projections_goblin;
create policy wnba_projections_goblin_read_all
on wnba_projections_goblin for select
using (true);

drop policy if exists wnba_players_read_all on wnba_players;
create policy wnba_players_read_all
on wnba_players for select
using (true);

drop policy if exists wnba_teams_read_all on wnba_teams;
create policy wnba_teams_read_all
on wnba_teams for select
using (true);

drop policy if exists wnba_lineups_read_all on wnba_lineups;
create policy wnba_lineups_read_all
on wnba_lineups for select
using (true);

-- ── Additional snapshot tables (edge board + defense-vs-position) ────────────
create table if not exists wnba_edge (
  id bigint primary key,
  data jsonb not null,
  updated_at timestamptz not null default now()
);

create table if not exists wnba_dvp_guard (
  id bigint primary key,
  data jsonb not null,
  updated_at timestamptz not null default now()
);

create table if not exists wnba_dvp_forward (
  id bigint primary key,
  data jsonb not null,
  updated_at timestamptz not null default now()
);

create table if not exists wnba_dvp_center (
  id bigint primary key,
  data jsonb not null,
  updated_at timestamptz not null default now()
);

drop trigger if exists wnba_edge_set_updated_at on wnba_edge;
create trigger wnba_edge_set_updated_at
before update on wnba_edge
for each row execute function set_updated_at();

drop trigger if exists wnba_dvp_guard_set_updated_at on wnba_dvp_guard;
create trigger wnba_dvp_guard_set_updated_at
before update on wnba_dvp_guard
for each row execute function set_updated_at();

drop trigger if exists wnba_dvp_forward_set_updated_at on wnba_dvp_forward;
create trigger wnba_dvp_forward_set_updated_at
before update on wnba_dvp_forward
for each row execute function set_updated_at();

drop trigger if exists wnba_dvp_center_set_updated_at on wnba_dvp_center;
create trigger wnba_dvp_center_set_updated_at
before update on wnba_dvp_center
for each row execute function set_updated_at();

alter table wnba_edge enable row level security;
alter table wnba_dvp_guard enable row level security;
alter table wnba_dvp_forward enable row level security;
alter table wnba_dvp_center enable row level security;

drop policy if exists wnba_edge_read_all on wnba_edge;
create policy wnba_edge_read_all
on wnba_edge for select
using (true);

drop policy if exists wnba_dvp_guard_read_all on wnba_dvp_guard;
create policy wnba_dvp_guard_read_all
on wnba_dvp_guard for select
using (true);

drop policy if exists wnba_dvp_forward_read_all on wnba_dvp_forward;
create policy wnba_dvp_forward_read_all
on wnba_dvp_forward for select
using (true);

drop policy if exists wnba_dvp_center_read_all on wnba_dvp_center;
create policy wnba_dvp_center_read_all
on wnba_dvp_center for select
using (true);

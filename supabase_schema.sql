-- Supabase schema for latest snapshot payloads consumed by kbo-props-ui.
-- Run this in Supabase SQL Editor.

create table if not exists strikeout_projections (
  id bigint primary key,
  data jsonb not null,
  updated_at timestamptz not null default now()
);

create table if not exists batter_projections (
  id bigint primary key,
  data jsonb not null,
  updated_at timestamptz not null default now()
);

create table if not exists pitcher_rankings (
  id bigint primary key,
  data jsonb not null,
  updated_at timestamptz not null default now()
);

create table if not exists prizepicks_props (
  id bigint primary key,
  data jsonb not null,
  updated_at timestamptz not null default now()
);

create table if not exists matchup_data (
  id bigint primary key,
  data jsonb not null,
  updated_at timestamptz not null default now()
);

create table if not exists prop_results (
  id bigint primary key,
  data jsonb not null,
  updated_at timestamptz not null default now()
);

create table if not exists pitcher_logs (
  id bigint primary key,
  data jsonb not null,
  updated_at timestamptz not null default now()
);

-- Keep updated_at fresh on upserts.
create or replace function set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists strikeout_projections_set_updated_at on strikeout_projections;
create trigger strikeout_projections_set_updated_at
before update on strikeout_projections
for each row execute function set_updated_at();

drop trigger if exists batter_projections_set_updated_at on batter_projections;
create trigger batter_projections_set_updated_at
before update on batter_projections
for each row execute function set_updated_at();

drop trigger if exists pitcher_rankings_set_updated_at on pitcher_rankings;
create trigger pitcher_rankings_set_updated_at
before update on pitcher_rankings
for each row execute function set_updated_at();

drop trigger if exists prizepicks_props_set_updated_at on prizepicks_props;
create trigger prizepicks_props_set_updated_at
before update on prizepicks_props
for each row execute function set_updated_at();

drop trigger if exists matchup_data_set_updated_at on matchup_data;
create trigger matchup_data_set_updated_at
before update on matchup_data
for each row execute function set_updated_at();

drop trigger if exists prop_results_set_updated_at on prop_results;
create trigger prop_results_set_updated_at
before update on prop_results
for each row execute function set_updated_at();

drop trigger if exists pitcher_logs_set_updated_at on pitcher_logs;
create trigger pitcher_logs_set_updated_at
before update on pitcher_logs
for each row execute function set_updated_at();

alter table strikeout_projections enable row level security;
alter table batter_projections enable row level security;
alter table pitcher_rankings enable row level security;
alter table prizepicks_props enable row level security;
alter table matchup_data enable row level security;
alter table prop_results enable row level security;
alter table pitcher_logs enable row level security;

-- Read policies: allow ALL (public + authenticated users).
-- Frontend fetches via anon key, which is safe because data is read-only.
-- Service role key used only by backend for writes.
drop policy if exists strikeout_projections_read_authenticated on strikeout_projections;
drop policy if exists strikeout_projections_read_all on strikeout_projections;
create policy strikeout_projections_read_all
on strikeout_projections for select
using (true);

drop policy if exists batter_projections_read_authenticated on batter_projections;
drop policy if exists batter_projections_read_all on batter_projections;
create policy batter_projections_read_all
on batter_projections for select
using (true);

drop policy if exists pitcher_rankings_read_authenticated on pitcher_rankings;
drop policy if exists pitcher_rankings_read_all on pitcher_rankings;
create policy pitcher_rankings_read_all
on pitcher_rankings for select
using (true);

drop policy if exists prizepicks_props_read_authenticated on prizepicks_props;
drop policy if exists prizepicks_props_read_all on prizepicks_props;
create policy prizepicks_props_read_all
on prizepicks_props for select
using (true);

drop policy if exists matchup_data_read_authenticated on matchup_data;
drop policy if exists matchup_data_read_all on matchup_data;
create policy matchup_data_read_all
on matchup_data for select
using (true);

drop policy if exists prop_results_read_authenticated on prop_results;
drop policy if exists prop_results_read_all on prop_results;
create policy prop_results_read_all
on prop_results for select
using (true);

drop policy if exists pitcher_logs_read_authenticated on pitcher_logs;
drop policy if exists pitcher_logs_read_all on pitcher_logs;
create policy pitcher_logs_read_all
on pitcher_logs for select
using (true);

-- ── Auto-create user_profiles row on signup ──
-- Ensures every new auth.users entry gets a free-tier profile row
-- so Stripe webhook / sync-subscription can upsert the tier later.

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.user_profiles (id, tier)
  values (new.id, 'free')
  on conflict (id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row
  execute function public.handle_new_user();

-- ── WNBA snapshot tables ──
-- Same blob pattern as the KBO tables above: one jsonb row (id=1) per dataset,
-- written by the backend with the service role key, read publicly via anon key.

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

-- ── WNBA edge board + defense-vs-position snapshot tables ────────────────────
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
create policy wnba_edge_read_all on wnba_edge for select using (true);

drop policy if exists wnba_dvp_guard_read_all on wnba_dvp_guard;
create policy wnba_dvp_guard_read_all on wnba_dvp_guard for select using (true);

drop policy if exists wnba_dvp_forward_read_all on wnba_dvp_forward;
create policy wnba_dvp_forward_read_all on wnba_dvp_forward for select using (true);

drop policy if exists wnba_dvp_center_read_all on wnba_dvp_center;
create policy wnba_dvp_center_read_all on wnba_dvp_center for select using (true);

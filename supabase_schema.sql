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

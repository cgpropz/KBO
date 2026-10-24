-- Slip-builder correlation pairs. Run this in the Supabase SQL editor
-- before the first correlations publish. The repo does not apply it.
-- A missing table is skipped by publish_supabase.py (OPTIONAL_TABLES),
-- so the rest of a sport refresh still ships.
--
-- Until these tables exist, PostgREST returns PGRST205 and /api/data
-- cannot read a snapshot. Applied to production on 2026-10-24.
-- Republish after that with PUBLISH_ONLY_PREFIX=correlations, or let the
-- next sport refresh build and publish its own file.

begin;

create table if not exists public.correlations_kbo (
  id bigint primary key,
  data jsonb not null,
  updated_at timestamptz not null default now()
);
create table if not exists public.correlations_wnba (
  id bigint primary key,
  data jsonb not null,
  updated_at timestamptz not null default now()
);
create table if not exists public.correlations_nfl (
  id bigint primary key,
  data jsonb not null,
  updated_at timestamptz not null default now()
);
create table if not exists public.nba_correlations (
  id bigint primary key,
  data jsonb not null,
  updated_at timestamptz not null default now()
);
create table if not exists public.nhl_correlations (
  id bigint primary key,
  data jsonb not null,
  updated_at timestamptz not null default now()
);

alter table public.correlations_kbo enable row level security;
alter table public.correlations_wnba enable row level security;
alter table public.correlations_nfl enable row level security;
alter table public.nba_correlations enable row level security;
alter table public.nhl_correlations enable row level security;

revoke all on public.correlations_kbo from anon, authenticated;
revoke all on public.correlations_wnba from anon, authenticated;
revoke all on public.correlations_nfl from anon, authenticated;
revoke all on public.nba_correlations from anon, authenticated;
revoke all on public.nhl_correlations from anon, authenticated;

commit;

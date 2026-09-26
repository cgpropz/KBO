-- ⚠ SECURITY NOTE (Phase 1 server-side paywall): the `*_read_all ... using (true)`
-- policies in this file made paid snapshot tables readable by anyone with the
-- public anon key. The site now reads these tables only through /api/data
-- (service role). If you ever re-run this file, run
-- sql/security/02_lock_down_rls.sql afterwards to remove public read access.

-- NFL PrizePicks snapshot. Run once in the Supabase SQL editor.
-- The row is written by GitHub Actions with the service-role key. Read access is
-- public (anon key), mirroring the KBO/WNBA blob tables -- gating (top-3 free
-- preview vs. full board) happens client-side in NflPropLines.jsx / Paywall.jsx,
-- not at the database layer. This matches the established architecture and fixes
-- the free-tier "NFL dashboard doesn't load" bug: the old policy restricted
-- SELECT to authenticated paid users only, so free (and anonymous) sessions got
-- zero rows and the client's `.single()` query threw before any UI gating could
-- run.

create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create table if not exists public.nfl_projections (
  id bigint primary key,
  data jsonb not null,
  updated_at timestamptz not null default now()
);

create table if not exists public.nfl_lineups (
  id bigint primary key,
  data jsonb not null,
  updated_at timestamptz not null default now()
);

drop trigger if exists nfl_projections_set_updated_at on public.nfl_projections;
create trigger nfl_projections_set_updated_at
before update on public.nfl_projections
for each row execute function public.set_updated_at();

drop trigger if exists nfl_lineups_set_updated_at on public.nfl_lineups;
create trigger nfl_lineups_set_updated_at
before update on public.nfl_lineups
for each row execute function public.set_updated_at();

alter table public.nfl_projections enable row level security;
alter table public.nfl_lineups enable row level security;

drop policy if exists nfl_projections_read_pro on public.nfl_projections;
drop policy if exists nfl_projections_read_all on public.nfl_projections;
create policy nfl_projections_read_all
on public.nfl_projections for select
using (true);

drop policy if exists nfl_lineups_read_pro on public.nfl_lineups;
drop policy if exists nfl_lineups_read_all on public.nfl_lineups;
create policy nfl_lineups_read_all
on public.nfl_lineups for select
using (true);
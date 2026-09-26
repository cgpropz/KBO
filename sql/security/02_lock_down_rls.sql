-- ============================================================================
-- Security Phase 1 · Migration 02 — lock down paid tables and user_profiles
-- ============================================================================
--
--   ██  RUN ONLY AFTER THE NEW DEPLOY IS LIVE  ██
--
-- Order matters. The previous frontend read these snapshot tables directly
-- with the public anon key. The new frontend reads them only through
-- /api/data (service role, server-side entitlement check). If you run this
-- BEFORE the new build is serving production, the old site will lose its data.
--
-- Checklist before running:
--   1. The server-side paywall PR is merged and deployed to production.
--   2. https://cgpropz.com/api/data?ds=prizepicks_props returns JSON with a
--      "preview" field (anonymous = true).
--   3. A paid account still sees the full board after a hard refresh.
--
-- What this does:
--   A. Paid snapshot tables: drops every RLS policy (including the old
--      `*_read_all ... using (true)` policies) and revokes all privileges from
--      the anon and authenticated roles. RLS stays enabled, so only the
--      service role (pipeline + Vercel API functions) can read/write them.
--   B. user_profiles: each signed-in user can SELECT only their own row. No
--      client INSERT/UPDATE/DELETE at all — tiers are written only by the
--      server (Stripe webhook / sync-subscription / reconcile, service role)
--      and the security-definer signup trigger.
--   C. saved_slips: drops the "Service role updates grading" policy, which
--      was `for update using (true)` and therefore let ANY user edit ANY
--      slip. The service role bypasses RLS and does not need a policy.
--
-- Idempotent; safe to re-run. Not executed automatically — paste into the
-- Supabase SQL editor.
-- ============================================================================

begin;

-- ── A. Paid snapshot tables ────────────────────────────────────────────────
do $$
declare
  t text;
  p record;
  paid_tables text[] := array[
    -- KBO
    'strikeout_projections', 'batter_projections', 'pitcher_rankings',
    'prizepicks_props', 'matchup_data', 'prop_results', 'pitcher_logs',
    'graded_props_history',
    -- WNBA
    'wnba_projections_standard', 'wnba_projections_demon',
    'wnba_projections_goblin', 'wnba_players', 'wnba_teams', 'wnba_lineups',
    'wnba_edge', 'wnba_dvp_guard', 'wnba_dvp_forward', 'wnba_dvp_center',
    -- NFL
    'nfl_projections', 'nfl_lineups'
  ];
begin
  foreach t in array paid_tables loop
    if to_regclass('public.' || t) is null then
      raise notice 'skipping %, table does not exist', t;
      continue;
    end if;

    execute format('alter table public.%I enable row level security', t);

    for p in
      select policyname from pg_policies
      where schemaname = 'public' and tablename = t
    loop
      execute format('drop policy if exists %I on public.%I', p.policyname, t);
    end loop;

    execute format('revoke all on public.%I from anon, authenticated', t);
  end loop;
end
$$;

-- ── B. user_profiles: select own row only, no client writes ────────────────
alter table public.user_profiles enable row level security;

do $$
declare
  p record;
begin
  for p in
    select policyname from pg_policies
    where schemaname = 'public' and tablename = 'user_profiles'
  loop
    execute format('drop policy if exists %I on public.user_profiles', p.policyname);
  end loop;
end
$$;

revoke all on public.user_profiles from anon, authenticated;
grant select on public.user_profiles to authenticated;

create policy user_profiles_select_own
  on public.user_profiles
  for select
  to authenticated
  using (auth.uid() = id);

-- ── C. saved_slips: remove the open UPDATE policy ──────────────────────────
drop policy if exists "Service role updates grading" on public.saved_slips;
revoke update on public.saved_slips from anon, authenticated;

commit;

-- ── Verify (optional) ──────────────────────────────────────────────────────
-- Expect: no rows for the paid tables; one select policy on user_profiles.
-- select tablename, policyname, cmd, roles, qual
--   from pg_policies
--  where schemaname = 'public'
--  order by tablename, policyname;

-- ============================================================================
-- Security · Migration 08: agent_reader may read public.nfl_matchup_defense
-- PROPOSED, NOT APPLIED. Needs Board QA's CONFIRM before it is applied by
-- hand to ocaqjkfdjqxszevtllew, as with 03, 05 and 07.
-- ============================================================================
-- Why: parity with the other NFL snapshot tables. Read-only catalog check,
-- 2026-10-18 ~2:25 AM ET:
--   * public.nfl_game_markets: RLS on, acl {postgres, service_role,
--     agent_reader=r}, one policy agent_reader_select
--     (PERMISSIVE, SELECT, to agent_reader, using (true)).
--   * public.nfl_matchup_defense: RLS on, acl {postgres, service_role},
--     no policies, so agent_reader cannot read it today.
--
-- SELECT only, plus one SELECT-only RLS policy scoped to agent_reader.
-- No INSERT/UPDATE/DELETE. anon, authenticated and board_reader are unchanged.
-- The table holds only team-level nflverse aggregates (no player, member or
-- paid data). Idempotent: safe to run twice.
-- ============================================================================

begin;
set local lock_timeout = '3s';

grant select on public.nfl_matchup_defense to agent_reader;

drop policy if exists agent_reader_select on public.nfl_matchup_defense;
create policy agent_reader_select on public.nfl_matchup_defense
  for select to agent_reader using (true);

commit;

-- Verify after applying (read-only). Expect agent_reader_select = true,
-- anon_select = false, authenticated_select = false, rls = true, and one
-- policy row matching nfl_game_markets:
--   select c.relname, c.relrowsecurity as rls, c.relacl::text as acl,
--          has_table_privilege('agent_reader', c.oid, 'select') as agent_reader_select,
--          has_table_privilege('anon', c.oid, 'select') as anon_select,
--          has_table_privilege('authenticated', c.oid, 'select') as authenticated_select
--   from pg_class c join pg_namespace n on n.oid = c.relnamespace
--   where n.nspname = 'public' and c.relname in ('nfl_game_markets', 'nfl_matchup_defense');
--
--   select tablename, policyname, permissive, roles::text, cmd, qual, with_check
--   from pg_policies
--   where schemaname = 'public' and tablename in ('nfl_game_markets', 'nfl_matchup_defense')
--   order by tablename, policyname;

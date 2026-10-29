-- ============================================================================
-- Security · Migration 11: board_reader may read public.nfl_game_markets
-- Code Green approved via Manager · COO, 6:22 AM ET Oct 29, 2026.
-- Applied by hand to ocaqjkfdjqxszevtllew (KBO_2026) on Oct 29, 2026
-- (~6:30 AM ET), in one transaction.
-- ============================================================================
-- Why: Prop Alert reads nfl_game_markets as board_reader and got
-- "permission denied for table nfl_game_markets".
--
-- Catalog before (read-only check, Oct 29 2026):
--   * RLS ON. relacl: postgres, service_role, agent_reader=r. One policy,
--     agent_reader_select (PERMISSIVE, SELECT, to agent_reader, using (true)).
--   * board_reader had NO select (09 and 10 deliberately left it out).
--   * nba_game_markets is identical (agent_reader only); it is NOT changed here.
--
-- Pattern: same as 03/05/07 board_reader grants (GRANT SELECT plus a
-- board_reader_select policy using (true)). agent_reader grant and policy
-- are re-asserted idempotently (they already existed; see 09).
-- SELECT only. No INSERT/UPDATE/DELETE. anon and authenticated stay revoked.
-- RLS stays enabled. Idempotent. 02_lock_down_rls.sql drops every policy on
-- the tables it lists; rerun this file after 02 if 02 is rerun.
-- ============================================================================

begin;
set local lock_timeout = '3s';

grant select on public.nfl_game_markets to board_reader;
grant select on public.nfl_game_markets to agent_reader;

drop policy if exists board_reader_select on public.nfl_game_markets;
create policy board_reader_select on public.nfl_game_markets
  as permissive for select to board_reader using (true);

do $$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public'
      and tablename = 'nfl_game_markets'
      and policyname = 'agent_reader_select'
  ) then
    create policy agent_reader_select on public.nfl_game_markets
      as permissive for select to agent_reader using (true);
  end if;
end
$$;

commit;

-- Verify (read-only):
--   begin; set local role board_reader;
--   select g->>'id', g->'total'->>'line', g->'spread'->>'line'
--   from public.nfl_game_markets m, jsonb_array_elements(m.data->'games') g
--   where g->>'awayTeam' = 'CAR' and g->>'homeTeam' = 'GB';
--   rollback;

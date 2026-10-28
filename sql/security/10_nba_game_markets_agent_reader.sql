-- ============================================================================
-- Security · Migration 10: agent_reader may read public.nba_game_markets
-- APPLY in the Supabase SQL editor. Not run by CI.
-- ============================================================================
-- Mirrors sql/security/09_nfl_game_markets_agent_reader_record.sql.
-- Live nfl_game_markets grants SELECT to agent_reader (not board_reader)
-- and has one policy, agent_reader_select (PERMISSIVE, SELECT, to
-- agent_reader, using (true)). #414 created nba_game_markets with postgres
-- and service_role only. This file adds the same reader grant.
--
-- sql/nba_game_markets.sql includes the same grant for a fresh apply.
-- Run this file when the table already exists.
--
-- SELECT only. No INSERT, UPDATE, or DELETE. anon and authenticated stay
-- revoked. board_reader is not granted. RLS stays enabled.
-- Idempotent. 02_lock_down_rls.sql drops every policy on the tables it
-- lists, including this one; rerun this file after 02 if 02 is rerun.
-- ============================================================================

begin;
set local lock_timeout = '3s';

grant select on public.nba_game_markets to agent_reader;

do $$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public'
      and tablename = 'nba_game_markets'
      and policyname = 'agent_reader_select'
  ) then
    create policy agent_reader_select on public.nba_game_markets
      as permissive for select to agent_reader using (true);
  end if;
end
$$;

commit;

-- Verify (read-only): one SELECT grant for agent_reader, one policy
-- agent_reader_select, RLS on, anon and authenticated select false.
--   select grantee, privilege_type from information_schema.role_table_grants
--   where table_schema = 'public' and table_name = 'nba_game_markets'
--     and grantee = 'agent_reader';
--   select policyname, permissive, roles::text, cmd, qual
--   from pg_policies
--   where schemaname = 'public' and tablename = 'nba_game_markets';

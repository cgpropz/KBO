-- ============================================================================
-- Security · Migration 09: record nfl_game_markets' existing agent_reader access
-- RECORD ONLY. NOT APPLIED. Production already has exactly this; the file
-- exists so the repo matches production (supabase_nfl_schema.sql creates the
-- table but never granted agent_reader).
-- ============================================================================
-- Copied from production's catalog (ocaqjkfdjqxszevtllew), read-only check
-- 2026-10-18 ~2:35 AM ET:
--   information_schema.role_table_grants:
--     agent_reader  SELECT  grantor postgres  is_grantable NO
--   pg_policy on public.nfl_game_markets (the only policy):
--     agent_reader_select  PERMISSIVE  cmd r (SELECT)  to agent_reader
--     using (true)  no with check
--   relacl {postgres=arwdDxtm/postgres, service_role=arwdDxtm/postgres,
--           agent_reader=r/postgres}; RLS on, not forced.
--
-- Idempotent, and a no-op on production: the grant is a repeat and the
-- policy is only created if missing (no drop/recreate window).
-- Note: 02_lock_down_rls.sql drops every policy on the tables it lists,
-- including this one; rerun this file after 02 if 02 is ever rerun.
-- ============================================================================

begin;
set local lock_timeout = '3s';

grant select on public.nfl_game_markets to agent_reader;

do $$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'nfl_game_markets' and policyname = 'agent_reader_select'
  ) then
    create policy agent_reader_select on public.nfl_game_markets
      as permissive for select to agent_reader using (true);
  end if;
end
$$;

commit;

-- Verify (read-only): expect one row SELECT/postgres and one policy row
-- agent_reader_select | PERMISSIVE | {agent_reader} | SELECT | true | null
--   select grantee, privilege_type, grantor from information_schema.role_table_grants
--   where table_schema = 'public' and table_name = 'nfl_game_markets' and grantee = 'agent_reader';
--   select policyname, permissive, roles::text, cmd, qual, with_check from pg_policies
--   where schemaname = 'public' and tablename = 'nfl_game_markets';

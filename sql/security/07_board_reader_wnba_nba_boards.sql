-- ============================================================================
-- Security · Migration 07 — board_reader may read the WNBA and NBA
-- published board tables
-- Board QA CONFIRMed 1:54 AM ET Oct 18, 2026. Applied by hand to
-- ocaqjkfdjqxszevtllew on Oct 18, 2026 (~1:56 AM ET), in one transaction.
-- ============================================================================
-- Why: the read-only QA checks (e.g. the PR #255 top-list before/after on
-- 2026-10-18) got "permission denied for table wnba_projections_standard" as
-- board_reader and had to fall back to the default connector role.
--
-- Catalog as of 2026-10-18 ~1:50 AM ET (read-only check):
--   * RLS is ON for every table below. Each has only agent_reader_select.
--   * board_reader has NO select on any of them.
--   * NHL: public.nhl_projections is already readable by board_reader
--     (03_board_reader_role.sql: GRANT SELECT + board_reader_select policy).
--     Nothing new is needed for the NHL board, so it is not repeated here.
--
-- Tables (published PrizePicks boards; id = 1 is the head row, chunked
-- snapshots are extra rows in the same table, so using (true) covers them):
--   public.wnba_projections_standard
--   public.wnba_projections_demon
--   public.wnba_projections_goblin
--   public.nba_projections_standard
--   public.nba_projections_demon
--   public.nba_projections_goblin
--
-- SELECT only, plus one SELECT-only RLS policy per table scoped to this role.
-- No INSERT/UPDATE/DELETE, no other tables (lineups, players, dvp, sharp
-- odds, teams stay as they are). board_reader stays NOINHERIT, NOBYPASSRLS
-- and default_transaction_read_only (see 03_board_reader_role.sql).
-- Idempotent. Apply by hand after Board QA confirms (as with 03 and 05).
-- ============================================================================

set lock_timeout = '3s';

grant select on
  public.wnba_projections_standard,
  public.wnba_projections_demon,
  public.wnba_projections_goblin,
  public.nba_projections_standard,
  public.nba_projections_demon,
  public.nba_projections_goblin
to board_reader;

drop policy if exists board_reader_select on public.wnba_projections_standard;
create policy board_reader_select on public.wnba_projections_standard
  for select to board_reader using (true);

drop policy if exists board_reader_select on public.wnba_projections_demon;
create policy board_reader_select on public.wnba_projections_demon
  for select to board_reader using (true);

drop policy if exists board_reader_select on public.wnba_projections_goblin;
create policy board_reader_select on public.wnba_projections_goblin
  for select to board_reader using (true);

drop policy if exists board_reader_select on public.nba_projections_standard;
create policy board_reader_select on public.nba_projections_standard
  for select to board_reader using (true);

drop policy if exists board_reader_select on public.nba_projections_demon;
create policy board_reader_select on public.nba_projections_demon
  for select to board_reader using (true);

drop policy if exists board_reader_select on public.nba_projections_goblin;
create policy board_reader_select on public.nba_projections_goblin
  for select to board_reader using (true);

-- Verify after applying (read-only):
--   select c.relname, has_table_privilege('board_reader', c.oid, 'select') as br_select
--   from pg_class c join pg_namespace n on n.oid = c.relnamespace
--   where n.nspname = 'public'
--     and c.relname in ('wnba_projections_standard','wnba_projections_demon','wnba_projections_goblin',
--                       'nba_projections_standard','nba_projections_demon','nba_projections_goblin',
--                       'nhl_projections');

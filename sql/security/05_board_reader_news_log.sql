-- ============================================================================
-- Security · Migration 05 — board_reader may read public.news_log
-- ============================================================================
-- Sniper's injury / OUT checks read news_log as board_reader and get
-- "permission denied". This adds SELECT on news_log only, plus one
-- SELECT-only RLS policy (RLS is on for news_log; checked Oct 17, 2026).
-- No INSERT/UPDATE/DELETE, no other tables. board_reader stays NOINHERIT,
-- NOBYPASSRLS and default_transaction_read_only (see 03_board_reader_role.sql).
-- Idempotent. Apply by hand after Board QA confirms.
-- ============================================================================

set lock_timeout = '3s';

grant select on public.news_log to board_reader;

drop policy if exists board_reader_select on public.news_log;
create policy board_reader_select on public.news_log
  for select to board_reader using (true);

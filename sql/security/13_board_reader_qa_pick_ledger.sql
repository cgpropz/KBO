-- ============================================================================
-- Security · Migration 13: board_reader may read public.qa_pick_ledger
-- Draft site work, Oct 30, 2026. SELECT only. Not applied during the
-- 6:00 AM–midnight ET board window.
-- ============================================================================
-- The public /results page is the pre-lock standard ledger. board_reader
-- had no SELECT (RLS is on; agent_reader and service_role already could read).
-- Same pattern as 03/05/07/11: GRANT SELECT plus board_reader_select using (true).
-- No INSERT/UPDATE/DELETE. anon and authenticated stay revoked.
-- ============================================================================

begin;
set local lock_timeout = '3s';

grant select on public.qa_pick_ledger to board_reader;

drop policy if exists board_reader_select on public.qa_pick_ledger;
create policy board_reader_select on public.qa_pick_ledger
  as permissive for select to board_reader using (true);

commit;

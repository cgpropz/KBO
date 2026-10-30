-- ============================================================================
-- Security · Migration 14: /results reads qa_pick_ledger as board_reader
-- ============================================================================
-- The public page calls this function with the service role. Postgres
-- refuses SET ROLE inside a security-definer function, so the function
-- is security definer and owned by board_reader: the body runs as that
-- role, and the board_reader_select policy applies. board_reader is
-- granted CREATE on public only for the ownership change, then that
-- grant is revoked. anon and authenticated cannot execute it.
-- No INSERT/UPDATE/DELETE.
--
-- Rows are the latest standard snapshot posted before the scheduled start
-- (snapshot_at < start_time). Ungraded rows are omitted here and again in
-- src/resultsLedger.js. A null result or a null graded_at is not a void.
-- Only Hit, Miss, Push, and Void with graded_at set are returned.
-- ============================================================================

begin;
set local lock_timeout = '3s';

create or replace function public.board_reader_results_rows()
returns jsonb
language plpgsql
volatile
security definer
set search_path = public
as $fn$
declare
  payload jsonb;
begin
  with keyed as (
    select
      id,
      lower(sport) as sport,
      slate_date,
      player,
      prop,
      line,
      side,
      lower(coalesce(nullif(btrim(odds_type), ''), nullif(btrim(raw->>'line_type'), ''), 'standard')) as odds_type,
      cg_score,
      free_top3 is true as free_top3,
      start_time,
      snapshot_at,
      actual,
      result,
      graded_at
    from public.qa_pick_ledger
  ),
  prelock as (
    select *
    from keyed
    where snapshot_at is not null
      and start_time is not null
      and snapshot_at < start_time
  ),
  latest as (
    select distinct on (sport, slate_date, player, prop, line, odds_type)
      *
    from prelock
    order by sport, slate_date, player, prop, line, odds_type, snapshot_at desc, id desc
  ),
  std as (
    select *
    from latest
    where odds_type = 'standard'
  ),
  max_snap as (
    select sport, slate_date, player, prop, max(snapshot_at) as max_snapshot_at
    from std
    group by 1, 2, 3, 4
  ),
  kept as (
    select s.*
    from std s
    join max_snap m using (sport, slate_date, player, prop)
    where s.snapshot_at = m.max_snapshot_at
      and s.graded_at is not null
      and lower(s.result) in ('hit', 'miss', 'push', 'void')
  )
  select coalesce(jsonb_agg(jsonb_build_object(
    'id', id,
    'sport', sport,
    'slate_date', slate_date,
    'player', player,
    'prop', prop,
    'line', line,
    'side', side,
    'odds_type', odds_type,
    'cg_score', cg_score,
    'free_top3', free_top3,
    'start_time', start_time,
    'snapshot_at', snapshot_at,
    'actual', actual,
    'result', result,
    'graded_at', graded_at
  )), '[]'::jsonb)
  into payload
  from kept;
  return payload;
end;
$fn$;

grant create on schema public to board_reader;
alter function public.board_reader_results_rows() owner to board_reader;
revoke create on schema public from board_reader;

revoke all on function public.board_reader_results_rows() from public;
revoke all on function public.board_reader_results_rows() from anon;
revoke all on function public.board_reader_results_rows() from authenticated;
grant execute on function public.board_reader_results_rows() to service_role;

commit;

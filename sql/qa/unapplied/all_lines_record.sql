-- ============================================================================
-- NOT APPLIED. Read-only all-lines / recap query for public.qa_pick_ledger.
-- Cloud agents and CI must not run this file. No INSERT, UPDATE, DELETE,
-- function, grant, table, or RLS policy. It does not change schema, so it
-- is not a CLEAR migration. Do not point it at Supabase project KBO_2026
-- (ocaqjkfdjqxszevtllew) from a cloud agent.
--
-- 1. Latest pre-lock snapshot per (sport, slate_date, player, prop, line,
--    odds_type), the same rule as public.board_reader_results_rows():
--    snapshot_at and start_time are both required, snapshot_at < start_time,
--    distinct on that key, order by snapshot_at desc, id desc.
--    odds_type falls back to raw->>'line_type', then 'standard'.
-- 2. Demon and goblin rows with side under are left out. Their overs stay.
--    Standard unders stay. A null side stays (it is not an under).
-- 3. Existing rows are not rewritten. The public results function and the
--    free top 3 stay standard-only; this query is the internal all-lines read.
-- ============================================================================

with keyed as (
  select
    id,
    lower(sport) as sport,
    slate_date,
    player,
    team,
    opponent,
    prop,
    line,
    lower(side) as side,
    lower(coalesce(nullif(btrim(odds_type), ''), nullif(btrim(raw->>'line_type'), ''), 'standard')) as odds_type,
    projection,
    cg_score,
    free_top3 is true as free_top3,
    start_time,
    snapshot_at,
    actual,
    result,
    graded_at,
    coalesce(
      nullif(btrim(raw->>'allowed_wager_types'), ''),
      nullif(btrim(raw->>'wagerTypes'), '')
    ) as allowed_wager_types,
    raw->>'projection_id' as projection_id
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
)
select *
from latest
where not (odds_type in ('demon', 'goblin') and side = 'under')
order by sport, slate_date, player, prop, line, odds_type;

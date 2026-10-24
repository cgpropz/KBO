-- Playable record from public.qa_pick_ledger (v1). Read-only. No new table
-- and no new columns.
--
-- Run this outside 6:00 AM–midnight America/New_York. The site does not run
-- it. Board QA writes the result into kbo-props-ui/api/_playableRecord.json
-- (see kbo-props-ui/src/playableRecord.js for the same rules).
--
-- 1. Latest pre-lock row per (sport, slate_date, player, prop, line, odds_type)
--    where snapshot_at < start_time. odds_type falls back to raw->>'line_type',
--    then 'standard'.
-- 2. Standard only: drop a row whose snapshot_at is older than the max
--    standard snapshot for (sport, slate_date, player, prop). A later demon or
--    goblin row does not supersede a standard line.
-- 3. Pulled on that latest row is Void (left out):
--    raw.removed >= true, or pp_status in
--    removed|suspended|held|hold|onhold|out|replaced|superseded.
-- 4. odds key = 'standard' AND result IN ('Hit','Miss').
--
-- wins = count Hit, losses = count Miss, hit_pct = wins / (wins + losses).
-- Demon and goblin lines never enter either count.
--
-- Checked 2026-10-24 against the ledger: NHL 2026-10-23 is 14 wins, 16 losses
-- (14/30 = 46.666...%, shown as 46.6%). Free top 3 on the surviving rows is
-- 2-1: Tyler Bertuzzi Miss, T.J. Hughes Hit, Patrick Kane Hit.

with keyed as (
  select
    id,
    lower(sport) as sport,
    slate_date,
    player,
    prop,
    line,
    lower(coalesce(nullif(btrim(odds_type), ''), nullif(btrim(raw->>'line_type'), ''), 'standard')) as odds_key,
    snapshot_at,
    start_time,
    result,
    free_top3 is true as free_top3,
    (
      case
        when jsonb_typeof(raw->'removed') = 'boolean' then (raw->'removed') = 'true'::jsonb
        when jsonb_typeof(raw->'removed') = 'number' then (raw->>'removed')::numeric >= 1
        when jsonb_typeof(raw->'removed') = 'string'
          and (raw->>'removed') ~ '^-?[0-9]+(\.[0-9]+)?$'
          then (raw->>'removed')::numeric >= 1
        else false
      end
      or lower(regexp_replace(coalesce(raw->>'pp_status', ''), '[^a-z]', '', 'g'))
        in ('removed', 'suspended', 'held', 'hold', 'onhold', 'out', 'replaced', 'superseded')
    ) as pulled
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
  select distinct on (sport, slate_date, player, prop, line, odds_key)
    *
  from prelock
  order by sport, slate_date, player, prop, line, odds_key, snapshot_at desc, id desc
),
std as (
  select *
  from latest
  where odds_key = 'standard'
),
max_snap as (
  select sport, slate_date, player, prop, max(snapshot_at) as max_snapshot_at
  from std
  group by 1, 2, 3, 4
),
playable as (
  select s.*
  from std s
  join max_snap m using (sport, slate_date, player, prop)
  where s.snapshot_at = m.max_snapshot_at
    and not s.pulled
    and s.result in ('Hit', 'Miss')
)
select
  sport,
  slate_date::text as slate_date,
  count(*) filter (where result = 'Hit')::int as wins,
  count(*) filter (where result = 'Miss')::int as losses,
  count(*) filter (where free_top3 and result = 'Hit')::int as free_wins,
  count(*) filter (where free_top3 and result = 'Miss')::int as free_losses,
  coalesce(
    jsonb_agg(jsonb_build_object('player', player, 'result', result) order by player)
      filter (where free_top3),
    '[]'::jsonb
  ) as free_top3
from playable
group by sport, slate_date
order by sport, slate_date;

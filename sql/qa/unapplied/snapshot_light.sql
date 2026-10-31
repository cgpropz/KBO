-- ============================================================================
-- NOT APPLIED. Cloud agents, CI, and builds must not run this file.
-- Do not run it against Supabase project KBO_2026 (ocaqjkfdjqxszevtllew)
-- until Code Green CLEAR. This file INSERTs pre-lock rows into
-- public.qa_pick_ledger (ON CONFLICT DO NOTHING). It does not UPDATE or
-- DELETE, and it creates no function, grant, table, or RLS policy.
-- The unique key does not include side or raw, so an old demon under is
-- left in place. sql/qa/unapplied/all_lines_record.sql drops those rows
-- at read time.
-- 2026-10-31 side rule: side 'under' is written only when allowed_wager_types
-- includes under. Demon and goblin rows never default to under. A CG below
-- 50 on an over-only line is side null, not a logged over. raw stores
-- allowed_wager_types and the PrizePicks projection id when the board has them.
-- ============================================================================
-- Board QA Bot: pre-lock snapshot of every live board into public.qa_pick_ledger
-- Reads (SELECT only): nfl_projections, nfl_lineups (landing OUT filter for NFL free_top3), nhl_projections, wnba_projections_{standard,demon,goblin}, wnba_lineups (WNBA tip time only),
--                      prizepicks_props, graded_props_history (no longer used by KBO), matchup_data
--   All board tables are read through board_data (id = 1 + the chunk ids its manifest names; PR #198 format).
--   A board whose chunk set is incomplete/mixed contributes no rows; its reason is in the board_error column.
-- Writes: INSERT into qa_pick_ledger only (ON CONFLICT DO NOTHING => re-runnable, never duplicates).
-- Lock rule: only picks whose game has NOT started are inserted. Started picks are counted as
--            missed_post_lock in the summary output and never inserted.
-- WNBA lock (2026-10-17c): real tip time = board prop/player start-time field, else the wnba_lineups export's
--            gameTime for the team (same wnba-refresh run), else 12:00 ET on game date (lock_source noon_fallback,
--            reported in the wnba_lock summary column and in each row's notes). Was: always 12:00 ET.
-- CG Score methods mirror cgpropz.com bundle /assets/index-B876gw9W.js (re-verified 2026-10-11 2:25 PM ET after PR #112). See README.md.
-- Unique key includes cg_score + free_top3: a rescore inserts a new row; an identical repeat does not.
-- free_top3 = the free top 3 the public sees, standard lines only (definition changed 2026-10-17; earlier rows not comparable):
--   NFL = landing page NFL free top 3; KBO / NHL / WNBA = each sport page's free top 3. Rules + file:line in each section.
with
cfg as (
  select now() as ts,
         (now() at time zone 'America/New_York') as now_et,
         (now() at time zone 'Asia/Seoul')      as now_kst,
         -- ET calendar day as YYYY-MM-DD: the server's gameAlreadyStarted() day fallback (api/_dataAccess.js:222-243)
         to_char((now() at time zone 'America/New_York')::date, 'YYYY-MM-DD') as et_today,
         -- NFL free top 3. true since 2026-10-18b: main api/_dataAccess.js shapeForTier runs filterStandardBoard before
         -- the free-preview trim (FILTER_STANDARD_BEFORE_FREE_PREVIEW = true, Code Green 10/17 7:53 AM ET: standard
         -- lines only for everyone). false = the old order (rank all line types, landing hides non-standard).
         true as nfl_server_standard_only
),
-- ---------------- Board reader (PR #198 snapshot chunks, added 2026-10-16) ----------------
-- Every board read goes through board_data. Reads ONLY id = 1 plus the chunk ids that id = 1's manifest names;
-- never all rows (the previous publish's chunks linger until the next publish).
--   Legacy:  id = 1 data is the board itself (array, or object without snapshotChunks) -> used as-is.
--   Chunked: id = 1 data = {snapshotChunks: {version, generated_at, kind 'list'|'object', ids[]}}.
--            Each chunk data = {version, generated_at (= version if present), kind, index (= position in ids), rows[] | object{}}.
--            list = rows concatenated in ids order; object = keys merged, a repeated key rejects the set.
--            updated_at = latest of id = 1 and its chunks (same as api/_snapshotChunks.js assembleSnapshotRows).
-- Any missing id = 1, invalid manifest, missing chunk, version/kind/index mismatch or key collision => that board
-- yields NO rows and its reason appears in board_errors (reported in the summary). Never a partial board.
board_req(board) as (values ('nfl_projections'), ('nfl_lineups'), ('nhl_projections'), ('wnba_projections_standard'), ('wnba_projections_demon'), ('wnba_projections_goblin'), ('wnba_lineups'), ('prizepicks_props'), ('matchup_data')),
board_heads as (
  select 'nfl_projections'::text board, h.id, h.data, h.updated_at from public.nfl_projections h where h.id = 1
  union all select 'nfl_lineups'::text board, h.id, h.data, h.updated_at from public.nfl_lineups h where h.id = 1   -- landing OUT filter only (2026-10-17)
  union all select 'nhl_projections'::text board, h.id, h.data, h.updated_at from public.nhl_projections h where h.id = 1
  union all select 'wnba_projections_standard'::text board, h.id, h.data, h.updated_at from public.wnba_projections_standard h where h.id = 1
  union all select 'wnba_projections_demon'::text board, h.id, h.data, h.updated_at from public.wnba_projections_demon h where h.id = 1
  union all select 'wnba_projections_goblin'::text board, h.id, h.data, h.updated_at from public.wnba_projections_goblin h where h.id = 1
  union all select 'wnba_lineups'::text board, h.id, h.data, h.updated_at from public.wnba_lineups h where h.id = 1   -- WNBA tip times only (2026-10-17c)
  union all select 'prizepicks_props'::text board, h.id, h.data, h.updated_at from public.prizepicks_props h where h.id = 1
  union all select 'matchup_data'::text board, h.id, h.data, h.updated_at from public.matchup_data h where h.id = 1
),
board_man as (
  select h.board, h.updated_at, h.data->'snapshotChunks' m,
         case when jsonb_typeof(h.data->'snapshotChunks'->'version') = 'string' then h.data->'snapshotChunks'->>'version' end version,
         h.data->'snapshotChunks'->>'kind' kind,
         case when jsonb_typeof(h.data->'snapshotChunks'->'ids') = 'array' then h.data->'snapshotChunks'->'ids' else '[]'::jsonb end ids
  from board_heads h
  where jsonb_typeof(h.data) = 'object' and h.data ? 'snapshotChunks'
),
board_ids as (
  select bm.board, x.ord - 1 as idx, x.v,
         case when jsonb_typeof(x.v) = 'number' then
           case when (x.v)::numeric = trunc((x.v)::numeric) then (x.v)::numeric::bigint end end as id
  from board_man bm, jsonb_array_elements(bm.ids) with ordinality x(v, ord)
),
board_chunk_rows as (
  select 'nfl_projections'::text board, c.id, c.data, c.updated_at from public.nfl_projections c
    where c.id in (select i.id from board_ids i where i.board = 'nfl_projections' and i.id is not null)
  union all select 'nfl_lineups'::text board, c.id, c.data, c.updated_at from public.nfl_lineups c
    where c.id in (select i.id from board_ids i where i.board = 'nfl_lineups' and i.id is not null)
  union all select 'nhl_projections'::text board, c.id, c.data, c.updated_at from public.nhl_projections c
    where c.id in (select i.id from board_ids i where i.board = 'nhl_projections' and i.id is not null)
  union all select 'wnba_projections_standard'::text board, c.id, c.data, c.updated_at from public.wnba_projections_standard c
    where c.id in (select i.id from board_ids i where i.board = 'wnba_projections_standard' and i.id is not null)
  union all select 'wnba_projections_demon'::text board, c.id, c.data, c.updated_at from public.wnba_projections_demon c
    where c.id in (select i.id from board_ids i where i.board = 'wnba_projections_demon' and i.id is not null)
  union all select 'wnba_projections_goblin'::text board, c.id, c.data, c.updated_at from public.wnba_projections_goblin c
    where c.id in (select i.id from board_ids i where i.board = 'wnba_projections_goblin' and i.id is not null)
  union all select 'wnba_lineups'::text board, c.id, c.data, c.updated_at from public.wnba_lineups c
    where c.id in (select i.id from board_ids i where i.board = 'wnba_lineups' and i.id is not null)
  union all select 'prizepicks_props'::text board, c.id, c.data, c.updated_at from public.prizepicks_props c
    where c.id in (select i.id from board_ids i where i.board = 'prizepicks_props' and i.id is not null)
  union all select 'matchup_data'::text board, c.id, c.data, c.updated_at from public.matchup_data c
    where c.id in (select i.id from board_ids i where i.board = 'matchup_data' and i.id is not null)
),
board_chunk_chk as (
  select i.board, i.idx, i.id, c.data, c.updated_at, bm.kind,
         case
           when c.id is null then 'missing chunk ' || (i.idx + 1) || ' of ' || jsonb_array_length(bm.ids) || ' (id ' || coalesce(i.id::text, i.v::text) || ')'
           when jsonb_typeof(c.data) is distinct from 'object'
             or jsonb_typeof(c.data->'version') is distinct from 'string'
             or c.data->>'version' is distinct from bm.version
             or (c.data->'generated_at' is not null and c.data->'generated_at' <> 'null'::jsonb
                 and c.data->'generated_at' <> to_jsonb(bm.version))
             then 'mixed set: chunk id ' || c.id || ' version/generated_at ' || coalesce(c.data->>'version', 'null') || '/' || coalesce(c.data->>'generated_at', 'null') || ' <> manifest ' || bm.version
           when c.data->>'kind' is distinct from bm.kind
             or case when jsonb_typeof(c.data->'index') = 'number' then (c.data->'index')::numeric <> i.idx else true end
             then 'mixed set: chunk id ' || c.id || ' kind/index (' || coalesce(c.data->>'kind', 'null') || '/' || coalesce(c.data->>'index', 'null') || ') <> expected (' || bm.kind || '/' || i.idx || ')'
           when bm.kind = 'list' and jsonb_typeof(c.data->'rows') is distinct from 'array'
             then 'missing chunk ' || (i.idx + 1) || ' of ' || jsonb_array_length(bm.ids) || ' (no rows array)'
           when bm.kind = 'object' and jsonb_typeof(c.data->'object') is distinct from 'object'
             then 'missing chunk ' || (i.idx + 1) || ' of ' || jsonb_array_length(bm.ids) || ' (no object)'
         end as err
  from board_ids i
  join board_man bm on bm.board = i.board
  left join board_chunk_rows c on c.board = i.board and c.id = i.id
),
board_obj_keys as (
  select k.board, x.key, x.value, k.idx
  from board_chunk_chk k,
       jsonb_each(case when jsonb_typeof(k.data->'object') = 'object' then k.data->'object' else '{}'::jsonb end) x
  where k.kind = 'object' and k.err is null
),
board_status as (
  select r.board,
         bm.board is not null as chunked,
         case
           when h.board is null then 'no id=1 row'
           when bm.board is null then null
           when bm.version is null or bm.version = ''
             or (bm.m->'generated_at' is not null and bm.m->'generated_at' <> 'null'::jsonb and bm.m->'generated_at' <> to_jsonb(bm.version))
             then 'manifest invalid: version/generated_at'
           when bm.kind is null or bm.kind not in ('list', 'object') then 'manifest invalid: kind ' || coalesce(bm.kind, 'null')
           when jsonb_array_length(bm.ids) = 0 then 'manifest invalid: ids empty or not an array'
           when exists (select 1 from board_ids i where i.board = r.board and i.id is null) then 'manifest invalid: non-integer id'
           when (select count(*) <> count(distinct i.id) from board_ids i where i.board = r.board) then 'manifest invalid: duplicate ids'
           when exists (select 1 from board_chunk_chk k where k.board = r.board and k.err is not null)
             then (select k.err from board_chunk_chk k where k.board = r.board and k.err is not null order by k.idx limit 1)
           when bm.kind = 'object' and exists (select 1 from board_obj_keys o where o.board = r.board group by o.key having count(*) > 1)
             then 'mixed set: object key collision'
         end as err
  from board_req r
  left join board_heads h on h.board = r.board
  left join board_man bm on bm.board = r.board
),
board_errors as (
  select board, err from board_status where err is not null
),
board_data as (
  -- legacy single row
  select h.board, h.data, h.updated_at
  from board_heads h join board_status s on s.board = h.board
  where not s.chunked and s.err is null
  union all
  -- chunked list: rows concatenated in ids order
  select bm.board,
         coalesce((select jsonb_agg(e.v order by k.idx, e.ord)
                   from board_chunk_chk k,
                        jsonb_array_elements(case when jsonb_typeof(k.data->'rows') = 'array' then k.data->'rows' else '[]'::jsonb end) with ordinality e(v, ord)
                   where k.board = bm.board), '[]'::jsonb),
         greatest(bm.updated_at, (select max(k.updated_at) from board_chunk_chk k where k.board = bm.board))
  from board_man bm join board_status s on s.board = bm.board and s.chunked and s.err is null
  where bm.kind = 'list'
  union all
  -- chunked object: keys merged (collisions rejected in board_status)
  select bm.board, coalesce((select jsonb_object_agg(o.key, o.value) from board_obj_keys o where o.board = bm.board), '{}'::jsonb),
         greatest(bm.updated_at, (select max(k.updated_at) from board_chunk_chk k where k.board = bm.board))
  from board_man bm join board_status s on s.board = bm.board and s.chunked and s.err is null
  where bm.kind = 'object'
),
-- ---------------- NFL ----------------
-- free_top3 (definition changed 2026-10-17) = the NFL free top 3 a logged-out visitor sees on the landing page:
--   1. Server preview, api/_dataAccess.js previewNflProjections :198-217 (on, src/nflPreviewFlag.js:8):
--      pool = lineMatchesStat (yardage line > 0.5) and not gameAlreadyStarted (:232-243: started/locked/removed,
--      start_time <= now, else gameday < ET today); score = nflCgScore (src/nfl/nflLineFloors.js: max(line, floor),
--      Receiving Yards 15.5 / Rush Yards 18.5); each player's best row (lower(trim(player)), ties -> earlier row);
--      top 3 by score desc, board order. 2026-10-18b: cfg.nfl_server_standard_only = true, so only standard, not-pulled
--      rows are ranked (server filterStandardBoard + dropPulledRows run before the preview).
--   2. Landing: src/PublicLanding.jsx:137,203,397 -> src/publicBoard.js rowsFromSnapshot :33-41 / publicBoardRows :49-56
--      -> src/memberHub.js nflHubRows :312-314 keeps standard rows only (line_type ?? oddsType, null = standard);
--      playableRows :158-167 drops held/OUT rows (rowIsHeldOrOut :71-80) and nfl_lineups OUT/IR names (:177-204).
--   No rankEligible field exists on NFL rows. Landing shows these rows (topHubRows :430-443, up to 6, one per player).
nfl_out as (   -- unavailableFromLineups('nfl'): injuries[*][*].status, lineups[*][*].status || injury
  select distinct trim(regexp_replace(translate(lower(replace(replace(pl->>'name', '’', ''''), '`', '''')), 'áàâäãåāéèêëēíìîïīóòôöõøōúùûüūñçýÿšžćčđłńśźż', 'aaaaaaaeeeeeiiiiiooooooouuuuuncyyszccdlnszz'), '[^a-z0-9]+', ' ', 'g')) as norm_name
  from board_data t,
       jsonb_array_elements(case when jsonb_typeof(t.data) = 'array' then t.data else '[]'::jsonb end) g,
       lateral (select x.value lst, false is_lineup from jsonb_each(case when jsonb_typeof(g->'injuries') = 'object' then g->'injuries' else '{}'::jsonb end) x
                union all
                select x.value, true from jsonb_each(case when jsonb_typeof(g->'lineups') = 'object' then g->'lineups' else '{}'::jsonb end) x) l,
       jsonb_array_elements(case when jsonb_typeof(l.lst) = 'array' then l.lst else '[]'::jsonb end) pl
  where t.board = 'nfl_lineups'
    and coalesce(pl->>'name', '') <> ''
    and (upper(regexp_replace(coalesce(case when l.is_lineup then coalesce(nullif(pl->>'status', ''), pl->>'injury') else pl->>'status' end, ''), '[^A-Za-z]', '', 'g')) like '%LTIR%' or upper(regexp_replace(coalesce(case when l.is_lineup then coalesce(nullif(pl->>'status', ''), pl->>'injury') else pl->>'status' end, ''), '[^A-Za-z]', '', 'g')) in ('LONGTERMIR', 'LONGTERMINJUREDRESERVE', 'IRLT', 'IR', 'INJUREDRESERVE')
             or upper(regexp_replace(coalesce(case when l.is_lineup then coalesce(nullif(pl->>'status', ''), pl->>'injury') else pl->>'status' end, ''), '[^A-Za-z]', '', 'g')) like 'OUT%' or upper(regexp_replace(coalesce(case when l.is_lineup then coalesce(nullif(pl->>'status', ''), pl->>'injury') else pl->>'status' end, ''), '[^A-Za-z]', '', 'g')) like '%SCRATCH%' or upper(regexp_replace(coalesce(case when l.is_lineup then coalesce(nullif(pl->>'status', ''), pl->>'injury') else pl->>'status' end, ''), '[^A-Za-z]', '', 'g')) like 'SUSPEN%')
),
nfl_src as (
  select e, ord, t.updated_at
  from board_data t, jsonb_array_elements(t.data) with ordinality x(e, ord)
  where t.board = 'nfl_projections'
),
nfl_c as (
  select e, ord, updated_at,
         e->>'player' player, e->>'team' team, e->>'opponent' opponent, e->>'prop' prop,
         (e->>'line')::numeric line, (e->>'projection')::numeric projection,
         (e->>'start_time')::timestamptz start_time, (e->>'gameday')::date gameday,
         -- Ga(): yardage props need line > 0.5
         not ((e->>'prop') ~* '\y(yards?|yds?)\y' and coalesce((e->>'line')::numeric,0) <= 0.5) as ga_ok,
         case e->>'prop' when 'Pass Attempts' then 28.5 when 'Pass Completions' then 18 when 'Pass TDs' then 1
           when 'Pass Yards' then 186.5 when 'Pass+Rush Yds' then 210.5 when 'Rec Targets' then 2
           when 'Receiving Yards' then 5.5 when 'Receptions' then 1.5 when 'Rush Attempts' then 2.5
           when 'Rush Yards' then 5.5 when 'Rush+Rec Yds' then 30.5 end as floor_line,
         -- server/landing floors (src/nfl/nflLineFloors.js NFL_LINE_FLOORS): Receiving Yards 15.5, Rush Yards 18.5
         case e->>'prop' when 'Pass Attempts' then 28.5 when 'Pass Completions' then 18 when 'Pass TDs' then 1
           when 'Pass Yards' then 186.5 when 'Pass+Rush Yds' then 210.5 when 'Rec Targets' then 2
           when 'Receiving Yards' then 15.5 when 'Receptions' then 1.5 when 'Rush Attempts' then 2.5
           when 'Rush Yards' then 18.5 when 'Rush+Rec Yds' then 30.5 end as srv_floor,
         coalesce(e->>'line_type', e->>'oddsType') as line_type,
  -- 2026-10-18b server pool (api/_dataAccess.js shapeForTier): FILTER_STANDARD_BEFORE_FREE_PREVIEW = true, so
  -- filterStandardBoard (src/standardBoard.js isStandardBoardLine: first non-null of odds_type, oddsType, line_type,
  -- lineType, trimmed + lowercased; none => standard) runs first, then prepareMemberBoard -> dropPulledRows
  -- (src/nhl/pointsGate.js: removed === true or pp_status ?? ppStatus in removed|suspended|held|hold|onhold|out|replaced|superseded), THEN ranking.
         coalesce(lower(trim(coalesce(e->>'odds_type', e->>'oddsType', e->>'line_type', e->>'lineType'))), 'standard') = 'standard' as srv_std,
         (coalesce((e->'removed') = 'true'::jsonb, false) or lower(regexp_replace(coalesce(e->>'pp_status', e->>'ppStatus', ''), '[^A-Za-z]', '', 'g')) in ('removed', 'suspended', 'held', 'hold', 'onhold', 'out', 'replaced', 'superseded')) as srv_pulled,
         coalesce((e->'started') = 'true'::jsonb or (e->'locked') = 'true'::jsonb or (e->'removed') = 'true'::jsonb
           or case when trim(coalesce(e->>'start_time', e->>'startTime', e->>'start_time_utc', e->>'kickoff_at')) ~ '^\d{4}-\d{2}-\d{2}([T ]\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}(:?\d{2})?)?)?$'
                   then trim(coalesce(e->>'start_time', e->>'startTime', e->>'start_time_utc', e->>'kickoff_at'))::timestamptz <= (select ts from cfg)
                   else coalesce(nullif(e->>'game_date', ''), nullif(e->>'gameDate', ''), nullif(e->>'gameday', '')) ~ '^\d{4}-\d{2}-\d{2}$' and coalesce(nullif(e->>'game_date', ''), nullif(e->>'gameDate', ''), nullif(e->>'gameday', '')) < (select et_today from cfg) end, false) as srv_started,
         coalesce(coalesce((e->'held') = 'true'::jsonb or (e->'isHeld') = 'true'::jsonb or (e->'onHold') = 'true'::jsonb or (e->'on_hold') = 'true'::jsonb or (e->'is_held') = 'true'::jsonb, false)
           or (upper(regexp_replace(coalesce(coalesce(e->>'status', e->>'injury_status'), ''), '[^A-Za-z]', '', 'g')) like '%LTIR%' or upper(regexp_replace(coalesce(coalesce(e->>'status', e->>'injury_status'), ''), '[^A-Za-z]', '', 'g')) in ('LONGTERMIR', 'LONGTERMINJUREDRESERVE', 'IRLT', 'IR', 'INJUREDRESERVE')
             or upper(regexp_replace(coalesce(coalesce(e->>'status', e->>'injury_status'), ''), '[^A-Za-z]', '', 'g')) like 'OUT%' or upper(regexp_replace(coalesce(coalesce(e->>'status', e->>'injury_status'), ''), '[^A-Za-z]', '', 'g')) like '%SCRATCH%' or upper(regexp_replace(coalesce(coalesce(e->>'status', e->>'injury_status'), ''), '[^A-Za-z]', '', 'g')) like 'SUSPEN%')
           or lower(regexp_replace(coalesce(coalesce(e->>'status', e->>'injury_status'), ''), '[^A-Za-z]', '', 'g')) in ('held', 'hold', 'onhold', 'suspended', 'removed')
           or (upper(regexp_replace(coalesce(coalesce(e->>'injury', e->>'injuryStatus'), ''), '[^A-Za-z]', '', 'g')) like '%LTIR%' or upper(regexp_replace(coalesce(coalesce(e->>'injury', e->>'injuryStatus'), ''), '[^A-Za-z]', '', 'g')) in ('LONGTERMIR', 'LONGTERMINJUREDRESERVE', 'IRLT', 'IR', 'INJUREDRESERVE')
             or upper(regexp_replace(coalesce(coalesce(e->>'injury', e->>'injuryStatus'), ''), '[^A-Za-z]', '', 'g')) like 'OUT%' or upper(regexp_replace(coalesce(coalesce(e->>'injury', e->>'injuryStatus'), ''), '[^A-Za-z]', '', 'g')) like '%SCRATCH%' or upper(regexp_replace(coalesce(coalesce(e->>'injury', e->>'injuryStatus'), ''), '[^A-Za-z]', '', 'g')) like 'SUSPEN%')
           or lower(regexp_replace(coalesce(coalesce(e->>'injury', e->>'injuryStatus'), ''), '[^A-Za-z]', '', 'g')) in ('held', 'hold', 'onhold', 'suspended', 'removed')
           or (upper(regexp_replace(coalesce(coalesce(e->>'pp_status', e->>'ppStatus', e->>'board_status', e->>'boardStatus', e->>'line_status', e->>'lineStatus'), ''), '[^A-Za-z]', '', 'g')) like '%LTIR%' or upper(regexp_replace(coalesce(coalesce(e->>'pp_status', e->>'ppStatus', e->>'board_status', e->>'boardStatus', e->>'line_status', e->>'lineStatus'), ''), '[^A-Za-z]', '', 'g')) in ('LONGTERMIR', 'LONGTERMINJUREDRESERVE', 'IRLT', 'IR', 'INJUREDRESERVE')
             or upper(regexp_replace(coalesce(coalesce(e->>'pp_status', e->>'ppStatus', e->>'board_status', e->>'boardStatus', e->>'line_status', e->>'lineStatus'), ''), '[^A-Za-z]', '', 'g')) like 'OUT%' or upper(regexp_replace(coalesce(coalesce(e->>'pp_status', e->>'ppStatus', e->>'board_status', e->>'boardStatus', e->>'line_status', e->>'lineStatus'), ''), '[^A-Za-z]', '', 'g')) like '%SCRATCH%' or upper(regexp_replace(coalesce(coalesce(e->>'pp_status', e->>'ppStatus', e->>'board_status', e->>'boardStatus', e->>'line_status', e->>'lineStatus'), ''), '[^A-Za-z]', '', 'g')) like 'SUSPEN%')
           or lower(regexp_replace(coalesce(coalesce(e->>'pp_status', e->>'ppStatus', e->>'board_status', e->>'boardStatus', e->>'line_status', e->>'lineStatus'), ''), '[^A-Za-z]', '', 'g')) in ('held', 'hold', 'onhold', 'suspended', 'removed'), false) as held_or_out,
         trim(regexp_replace(translate(lower(replace(replace(coalesce(e->>'player', ''), '’', ''''), '`', '''')), 'áàâäãåāéèêëēíìîïīóòôöõøōúùûüūñçýÿšžćčđłńśźż', 'aaaaaaaeeeeeiiiiiooooooouuuuuncyyszccdlnszz'), '[^a-z0-9]+', ' ', 'g')) as norm_name,
         coalesce(nullif(lower(trim(coalesce(e->>'player', ''))), ''), chr(1) || ord::text) as srv_player_key
  from nfl_src
),
nfl_s as (
  -- 2026-10-18a (PR #253, main dd765fc8f): cg = srv_score = site nflCgScore (src/nfl/nflLineFloors.js):
  --   raw = projection / max(line, NFL_LINE_FLOORS[prop]) * 50 (RecYds 15.5, RushYds 18.5 = every live view; the old
  --   5.5 floor_line is no longer used anywhere on the site); projection > line => max(raw, 50) (a short over the floor
  --   would push under 50 holds at exactly 50 = neutral); projection = line => 50; else min(raw, 50); then bounded 0-100.
  --   No rounding (site shows toFixed(1); ledger stores round(cg, 2)). raw_score = nflRawScore, the tie-break at the cap.
  --   Computed in float8 (IEEE double, same as the site's JS) so exact ties (e.g. 55 vs 55.00000000000001) order the
  --   same way as the site; numeric math made 10 of 706 board_rank ties differ on the 10/18 board.
  select nfl_c.*, r.raw_score,
         case when r.raw_score is not null then least(100, greatest(0,
              case when projection > line then greatest(r.raw_score, 50) when projection = line then 50
                   else least(r.raw_score, 50) end)) end as cg,
         case when r.raw_score is not null then least(100, greatest(0,
              case when projection > line then greatest(r.raw_score, 50) when projection = line then 50
                   else least(r.raw_score, 50) end)) end as srv_score,
            coalesce(ga_ok and not srv_started and not srv_pulled
              and (not (select nfl_server_standard_only from cfg) or srv_std), false) as srv_pool
  from nfl_c
  cross join lateral (select case when ga_ok and line > 0 and projection is not null
                                  then projection::float8 / greatest(line, coalesce(srv_floor, line))::float8 * 50 end as raw_score) r
),
nfl_best as (   -- each player's highest-scoring pool row (ties -> higher raw score, then earlier board row)
  -- 2026-10-18a: server nflScore is -Infinity for exactly 50 (neutral, never a free slot), so 50 rows are not candidates.
  select ord, row_number() over (partition by srv_player_key order by srv_score desc nulls last, raw_score desc nulls last, ord) as player_pick
  from nfl_s where srv_pool and srv_score is distinct from 50
),
nfl_srv as (    -- server preview: top 3 players by their best score (ties at the 100 cap -> raw score, then board order)
  select b.ord, row_number() over (order by s.srv_score desc, s.raw_score desc, s.ord) as srv_rank
  from nfl_best b join nfl_s s on s.ord = b.ord
  where b.player_pick = 1 and s.srv_score is not null
),
nfl as (
  select 'NFL'::text sport, gameday slate_date, player, team, opponent, prop, line,
         -- 2026-10-18a: side = site cgSide(nflCgScore): > 50 over, < 50 under, exactly 50 or unscored => null (no pick)
         (select case
           when gated.side is distinct from 'under' then gated.side
           when lower(coalesce(nullif(btrim(coalesce(e->>'odds_type', e->>'oddsType', e->>'line_type', e->>'lineType')), ''), 'standard')) in ('demon', 'goblin') then case when (lower(btrim(coalesce(
             nullif(btrim(e->>'allowed_wager_types'), ''),
             nullif(btrim(e->>'allowedWagerTypes'), ''),
             nullif(btrim(e->>'wager_types'), ''),
             nullif(btrim(e->>'wagerTypes'), ''),
             ''))) ~ '(^|[^a-z])(under|less)([^a-z]|$)') then 'under' else null end
           when (lower(btrim(coalesce(
             nullif(btrim(e->>'allowed_wager_types'), ''),
             nullif(btrim(e->>'allowedWagerTypes'), ''),
             nullif(btrim(e->>'wager_types'), ''),
             nullif(btrim(e->>'wagerTypes'), ''),
             ''))) <> '') and not ((lower(btrim(coalesce(
             nullif(btrim(e->>'allowed_wager_types'), ''),
             nullif(btrim(e->>'allowedWagerTypes'), ''),
             nullif(btrim(e->>'wager_types'), ''),
             nullif(btrim(e->>'wagerTypes'), ''),
             ''))) ~ '(^|[^a-z])(under|less)([^a-z]|$)')) then null
           else 'under'
         end
         from (select /* ledger-wager-side */ case when cg > 50 then 'over' when cg < 50 then 'under' end as side) gated) side,
         null::text odds_type, projection, round(cg::numeric, 2) cg_score,
         'NFL nflCgScore (PR #253): raw = projection / max(line, floor[prop]) * 50; floors PassAtt 28.5, PassCmp 18, PassTD 1, PassYds 186.5, Pass+RushYds 210.5, RecTgt 2, RecYds 15.5, Rec 1.5, RushAtt 2.5, RushYds 18.5, Rush+RecYds 30.5; over => max(raw,50), on line => 50, under => min(raw,50); bounded 0-100; 50 = neutral; yardage lines <=0.5 excluded (null)' cg_score_method,
         -- 2026-10-18b: board_rank = position on the public (member) board: standard, not pulled; demon/goblin/pulled => null
         case when cg is not null and srv_std and not srv_pulled
              then row_number() over (partition by (cg is not null and srv_std and not srv_pulled) order by cg desc, raw_score desc, ord) end board_rank,
         -- landing free top 3 (rule above): server top 3, then standard + not held/OUT
         coalesce((select v.srv_rank from nfl_srv v where v.ord = nfl_s.ord) <= 3, false)
           and srv_std
           and not held_or_out
           and not exists (select 1 from nfl_out o where o.norm_name = nfl_s.norm_name and nfl_s.norm_name <> '') free_top3,
         start_time, updated_at published_at, 'nfl_projections' source_table, /* ledger-raw-stamp */ (e || jsonb_strip_nulls(jsonb_build_object(
           'allowed_wager_types', nullif(lower(btrim(coalesce(
             nullif(btrim(e->>'allowed_wager_types'), ''),
             nullif(btrim(e->>'allowedWagerTypes'), ''),
             nullif(btrim(e->>'wager_types'), ''),
             nullif(btrim(e->>'wagerTypes'), ''),
             ''))), ''),
           'projection_id', nullif(btrim(coalesce(
             e->>'projection_id',
             e->>'projectionId',
             case when btrim(coalesce(e->>'id', '')) ~ '^[0-9]+$' then btrim(e->>'id') end,
             ''
           )), '')
         ))) raw,
         'side = site cgSide (CG > 50 over, < 50 under, exactly 50 neutral => null; 2026-10-18a). board_rank over the public NFL board (standard, not pulled; incl. started games; ties -> raw score; else null) (2026-10-18b). free_top3 (2026-10-17 rule) = landing NFL free top 3: server previewNflProjections top 3 over standard, not-pulled rows (2026-10-18b; best prop per player, nflLineFloors score, 50 excluded, ties -> raw score) then not held/OUT on the landing. line_type in raw.' notes,
         start_time > (select ts from cfg) as pre_lock
  from nfl_s
),
-- ---------------- NHL ----------------
-- free_top3 (definition changed 2026-10-17) = the NHL page's free top 3 (nhl/NhlApp.jsx:44 Dashboard = NhlPropLines,
-- the only un-paywalled view :76; NhlPropLines.jsx:158-172 shows every row /api/data sends), restricted to standard:
--   server shapeForTier (api/_dataAccess.js:576) -> prepareBoardRows (src/nhl/pointsGate.js:236-241: drop removed /
--   pp_status removed|suspended|held|hold|onhold|out|replaced|superseded, drop Points overs with projection < 0.69, Points overs 0.69-0.86 get
--   rankEligible false) -> previewList(nhlScore) (:535, :341-347, :329-335): nhlScore :251-255 = -inf when
--   rankEligible false, gameAlreadyStarted (:232-243), or Points over not promoted; else projection / line * 50
--   (yardage rule). Top 3 by score desc, board order. 2026-10-18b: ranked over standard, not-pulled rows only (server
--   filterStandardBoard + dropPulledRows run before the preview), so free_top3 = exactly the server's 3.
nhl_src as (
  select e, ord, coalesce((t.data->0->>'generated_at')::timestamptz, t.updated_at) updated_at
  from board_data t, jsonb_array_elements(t.data) with ordinality x(e, ord)
  where t.board = 'nhl_projections'
),
nhl_s as (
  select e, ord, updated_at, (e->>'line')::numeric line, (e->>'projection')::numeric projection,
         (e->>'start_time')::timestamptz start_time,
         case when (e->>'line')::numeric > 0 then coalesce((e->>'projection')::numeric, 0) / (e->>'line')::numeric * 50 else 0 end cg,
         coalesce((e->>'rankEligible')::boolean, true) elig,
         -- pointsOverDisposition (src/nhl/pointsGate.js:206-215): rank | hold | drop
         case when lower(trim(coalesce(e->>'prop', e->>'stat', ''))) <> 'points'
                or (e->>'projection') is null or (e->>'line') is null
                or round((e->>'projection')::numeric * 100) < round((e->>'line')::numeric * 100) then 'rank'
              when round((e->>'projection')::numeric * 100) < 69 then 'drop'
              when round((e->>'projection')::numeric * 100) < 86 then 'hold'
              else 'rank' end as pts_disp,
         coalesce(coalesce((e->'removed') = 'true'::jsonb, false)
            or lower(regexp_replace(coalesce(e->>'pp_status', e->>'ppStatus', ''), '[^A-Za-z]', '', 'g')) in ('removed', 'suspended', 'held', 'hold', 'onhold', 'out', 'replaced', 'superseded'), false) as srv_pulled,
         coalesce((e->'started') = 'true'::jsonb or (e->'locked') = 'true'::jsonb or (e->'removed') = 'true'::jsonb
           or case when trim(coalesce(e->>'start_time', e->>'startTime', e->>'start_time_utc', e->>'kickoff_at')) ~ '^\d{4}-\d{2}-\d{2}([T ]\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}(:?\d{2})?)?)?$'
                   then trim(coalesce(e->>'start_time', e->>'startTime', e->>'start_time_utc', e->>'kickoff_at'))::timestamptz <= (select ts from cfg)
                   else coalesce(nullif(e->>'game_date', ''), nullif(e->>'gameDate', ''), nullif(e->>'gameday', '')) ~ '^\d{4}-\d{2}-\d{2}$' and coalesce(nullif(e->>'game_date', ''), nullif(e->>'gameDate', ''), nullif(e->>'gameday', '')) < (select et_today from cfg) end, false) as srv_started,
         (e->'rankEligible') = 'false'::jsonb as srv_inelig,
         coalesce(not ((coalesce(e->>'prop', e->>'stat')) ~* '\y(yards?|yds?)\y' and coalesce((e->>'line')::numeric, 0) <= 0.5), true) as line_ok,
  -- 2026-10-18b server pool (api/_dataAccess.js shapeForTier): FILTER_STANDARD_BEFORE_FREE_PREVIEW = true, so
  -- filterStandardBoard (src/standardBoard.js isStandardBoardLine: first non-null of odds_type, oddsType, line_type,
  -- lineType, trimmed + lowercased; none => standard) runs first, then prepareMemberBoard -> dropPulledRows
  -- (src/nhl/pointsGate.js: removed === true or pp_status ?? ppStatus in removed|suspended|held|hold|onhold|out|replaced|superseded), THEN ranking.
         coalesce(lower(trim(coalesce(e->>'odds_type', e->>'oddsType', e->>'line_type', e->>'lineType'))), 'standard') = 'standard' as is_standard
  from nhl_src
),
nhl_srv as (   -- server preview top 3 over standard, not-pulled rows (2026-10-18b); float8 score like the site JS
  select ord, row_number() over (order by (projection::float8 / line::float8 * 50) desc, ord) as srv_rank
  from nhl_s
  where is_standard and not srv_pulled and pts_disp = 'rank' and not coalesce(srv_inelig, false) and not srv_started
    and line_ok and projection is not null and line > 0
),
nhl as (
  select 'NHL', (start_time at time zone 'America/New_York')::date, e->>'player', e->>'team', e->>'opponent', e->>'prop', line,
         -- 2026-10-18b: side = src/pickSide.js pickSide(projection, line, cgScore) (#255, NhlPropLines.jsx:90):
         -- no projection/line, CG exactly 50, or projection = line => null (no pick); else over/under
         (select case
           when gated.side is distinct from 'under' then gated.side
           when lower(coalesce(nullif(btrim(coalesce(e->>'odds_type', e->>'oddsType', e->>'line_type', e->>'lineType')), ''), 'standard')) in ('demon', 'goblin') then case when (lower(btrim(coalesce(
             nullif(btrim(e->>'allowed_wager_types'), ''),
             nullif(btrim(e->>'allowedWagerTypes'), ''),
             nullif(btrim(e->>'wager_types'), ''),
             nullif(btrim(e->>'wagerTypes'), ''),
             ''))) ~ '(^|[^a-z])(under|less)([^a-z]|$)') then 'under' else null end
           when (lower(btrim(coalesce(
             nullif(btrim(e->>'allowed_wager_types'), ''),
             nullif(btrim(e->>'allowedWagerTypes'), ''),
             nullif(btrim(e->>'wager_types'), ''),
             nullif(btrim(e->>'wagerTypes'), ''),
             ''))) <> '') and not ((lower(btrim(coalesce(
             nullif(btrim(e->>'allowed_wager_types'), ''),
             nullif(btrim(e->>'allowedWagerTypes'), ''),
             nullif(btrim(e->>'wager_types'), ''),
             nullif(btrim(e->>'wagerTypes'), ''),
             ''))) ~ '(^|[^a-z])(under|less)([^a-z]|$)')) then null
           else 'under'
         end
         from (select /* ledger-wager-side */ case when projection is null or line is null then null
              when line_ok and line > 0 and projection::float8 / line::float8 * 50 = 50 then null
              when projection > line then 'over' when projection < line then 'under' end as side) gated),
         e->>'oddsType', projection, round(cg, 2),
         'NHL ec(): projection / line * 50 (board ranks rankEligible=false last)',
         -- 2026-10-18b: public board only (standard, not pulled, Points overs < 0.69 dropped; held 0.69-0.86 rank last)
         case when is_standard and not srv_pulled and pts_disp <> 'drop'
              then row_number() over (partition by (is_standard and not srv_pulled and pts_disp <> 'drop')
                                      order by (not elig or pts_disp = 'hold'), (case when line > 0 then coalesce(projection, 0)::float8 / line::float8 * 50 else 0 end) desc, ord) end::int,
         coalesce((select v.srv_rank from nhl_srv v where v.ord = nhl_s.ord) <= 3, false) and is_standard,
         start_time, updated_at, 'nhl_projections', /* ledger-raw-stamp */ (e || jsonb_strip_nulls(jsonb_build_object(
           'allowed_wager_types', nullif(lower(btrim(coalesce(
             nullif(btrim(e->>'allowed_wager_types'), ''),
             nullif(btrim(e->>'allowedWagerTypes'), ''),
             nullif(btrim(e->>'wager_types'), ''),
             nullif(btrim(e->>'wagerTypes'), ''),
             ''))), ''),
           'projection_id', nullif(btrim(coalesce(
             e->>'projection_id',
             e->>'projectionId',
             case when btrim(coalesce(e->>'id', '')) ~ '^[0-9]+$' then btrim(e->>'id') end,
             ''
           )), '')
         ))),
         'side = pickSide (#255): over/under vs line, projection = line or CG 50 => null (2026-10-18b). board_rank over the public NHL board (standard, not pulled, Points gate). free_top3 = NHL page free top 3: server nhlScore preview over standard, not-pulled rows (2026-10-18b; not started, rankEligible, Points-over gate).',
         start_time > (select ts from cfg)
  from nhl_s
),
-- ---------------- WNBA ----------------
wnba_src as (
  select 'standard'::text ot, t.updated_at, e, eo, p, po from board_data t,
         jsonb_array_elements(t.data) with ordinality a(e, eo), jsonb_array_elements(coalesce(e->'ppAllProps','[]')) with ordinality b(p, po)
  where t.board = 'wnba_projections_standard'
  union all
  select 'demon', t.updated_at, e, eo, p, po from board_data t,
         jsonb_array_elements(t.data) with ordinality a(e, eo), jsonb_array_elements(coalesce(e->'ppAllProps','[]')) with ordinality b(p, po)
  where t.board = 'wnba_projections_demon'
  union all
  select 'goblin', t.updated_at, e, eo, p, po from board_data t,
         jsonb_array_elements(t.data) with ordinality a(e, eo), jsonb_array_elements(coalesce(e->'ppAllProps','[]')) with ordinality b(p, po)
  where t.board = 'wnba_projections_goblin'
),
-- WNBA tip times (2026-10-17c). wnba_lineups = [{home:{abbr,rawAbbr}, visitor:{abbr,rawAbbr}, gameTime:'3:30 PM ET'}]
-- from the same wnba-refresh run as the boards; it has no date, so a game applies only to props whose gameDate is the
-- export's ET date (or the game's own date field, if one is ever added).
wnba_games as (
  select upper(trim(g->'home'->>'abbr')) h1, upper(trim(g->'home'->>'rawAbbr')) h2,
         upper(trim(g->'visitor'->>'abbr')) v1, upper(trim(g->'visitor'->>'rawAbbr')) v2,
         nullif(trim(coalesce(g->>'start_time', g->>'startTime', g->>'gameTime', g->>'game_time', g->>'tipoff')), '') raw_time,
         case when coalesce(g->>'gameDate', g->>'game_date', g->>'date') ~ '^\d{4}-\d{2}-\d{2}$'
              then (coalesce(g->>'gameDate', g->>'game_date', g->>'date'))::date
              else (t.updated_at at time zone 'America/New_York')::date end as g_date,
         go
  from board_data t, jsonb_array_elements(case when jsonb_typeof(t.data) = 'array' then t.data else '[]'::jsonb end) with ordinality x(g, go)
  where t.board = 'wnba_lineups'
),
wnba_s0 as (
  select *, (p->>'line')::numeric line, coalesce((p->>'standardLine')::numeric, (p->>'line')::numeric) disp_line,
         (p->>'projection')::numeric projection, (p->>'gameDate')::date game_date,
         -- board field: prop first, then player (none published as of 2026-10-17 11:16 AM board)
         nullif(trim(coalesce(p->>'start_time', p->>'startTime', p->>'start_time_utc', p->>'gameTime', p->>'game_time', p->>'tipoff', p->>'commence_time',
                              e->>'start_time', e->>'startTime', e->>'start_time_utc', e->>'gameTime', e->>'game_time', e->>'tipoff', e->>'commence_time')), '') as board_raw_time
  from wnba_src
),
wnba_s as (
  select s0.*, lk.lock_at, coalesce(lk.src, 'noon_fallback') as lock_source
  from wnba_s0 s0
  left join lateral (
    select c.src, v.ts as lock_at
    from (values
            (1, 'board', s0.board_raw_time),
            (2, 'wnba_lineups', (select g.raw_time from wnba_games g
                                 where g.g_date = s0.game_date
                                   and upper(trim(s0.e->>'team')) in (g.h1, g.h2, g.v1, g.v2)
                                 order by g.go limit 1))
         ) c(pri, src, raw)
    cross join lateral (select
      case
        -- ISO with zone
        when c.raw ~ '^\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}(:?\d{2})?)$' then c.raw::timestamptz
        -- ISO without zone => ET
        when c.raw ~ '^\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}(:\d{2}(\.\d+)?)?$' then c.raw::timestamp at time zone 'America/New_York'
        -- clock time on the prop's game date, ET (suffix ET/EST/EDT or none), e.g. '3:30 PM ET', '7 PM'
        when s0.game_date is not null and c.raw ~* '^\d{1,2}(:\d{2})?\s*(AM|PM)(\s*(ET|EST|EDT))?$'
          then (s0.game_date + regexp_replace(regexp_replace(c.raw, '\s*(ET|EST|EDT)$', '', 'i'), '^(\d{1,2})\s*(AM|PM)$', '\1:00 \2', 'i')::time)
               at time zone 'America/New_York'
      end as ts) v(ts)
    -- first source (board, then wnba_lineups) whose value parses
    where v.ts is not null
    order by c.pri
    limit 1
  ) lk on true
),
wnba_s2 as (
  -- Site bundle /assets/index-B876gw9W.js (PR #112, re-verified 2026-10-11 2:25 PM ET):
  --   Xy(proj, prop) = proj / max(prop.line, cA[stat]) * 50, scored against the row's OWN line
  --   (demon/goblin no longer use standardLine). Yardage-stat lines <= 0.5 => null.
  --   Board (ZC): projection ?? player-level proj (VC), "Points - 1st 3 Minutes" excluded.
  --   Free top 3: see wnba_s3 / wnba_srv (2026-10-17 rule, replaces the old bundle GA() preview rule).
  select *,
         case p->>'stat' when '3-PT Attempted' then 3.5 when '3-PT Made' then 1.5 when 'Assists' then 1.5
           when 'Blks+Stls' then 1.5 when 'Blocked Shots' then 0.5 when 'Defensive Rebounds' then 4.5
           when 'FG Attempted' then 9.5 when 'FG Made' then 4.5 when 'Fantasy Score' then 15.5
           when 'Free Throws Attempted' then 3.5 when 'Free Throws Made' then 2.5 when 'Minutes Played' then 33
           when 'Offensive Rebounds' then 0.5 when 'Points' then 4.5 when 'Pts+Asts' then 7.5 when 'Pts+Rebs' then 9.5
           when 'Pts+Rebs+Asts' then 10.5 when 'Rebounds' then 3.5 when 'Rebs+Asts' then 5 when 'Steals' then 1.5
           when 'Turnovers' then 1.5 when 'Two Pointers Attempted' then 6 when 'Two Pointers Made' then 3.5 end as min_line,
         coalesce(projection, case p->>'stat'
           when 'Points' then (e->>'projPts')::numeric when 'Rebounds' then (e->>'projReb')::numeric
           when 'Assists' then (e->>'projAst')::numeric when '3-PT Made' then (e->>'projFg3m')::numeric
           when 'Steals' then (e->>'projStl')::numeric when 'Blocks' then (e->>'projBlk')::numeric
           when 'Turnovers' then (e->>'projTov')::numeric when 'Offensive Rebounds' then (e->>'projOreb')::numeric
           when 'Defensive Rebounds' then (e->>'projDreb')::numeric when 'Fantasy Score' then (e->>'projFantasy')::numeric
           when 'Reb+Asts' then coalesce((e->>'projReb')::numeric,0)+coalesce((e->>'projAst')::numeric,0)
           when 'Rebs+Asts' then coalesce((e->>'projReb')::numeric,0)+coalesce((e->>'projAst')::numeric,0)
           when 'Pts+Rebs' then coalesce((e->>'projPts')::numeric,0)+coalesce((e->>'projReb')::numeric,0)
           when 'Pts+Asts' then coalesce((e->>'projPts')::numeric,0)+coalesce((e->>'projAst')::numeric,0)
           when 'Pts+Rebs+Asts' then coalesce((e->>'projPts')::numeric,0)+coalesce((e->>'projReb')::numeric,0)+coalesce((e->>'projAst')::numeric,0)
           when 'Double-Double' then (e->>'projDoubleDouble')::numeric when 'Triple-Double' then (e->>'projTripleDouble')::numeric end) as board_proj,
         (p->>'stat') ~* '\y(yards?|yds?)\y' and coalesce(line, 0) <= 0.5 as ua_fail,
         p->>'stat' = 'Points - 1st 3 Minutes' excluded_from_board
  from wnba_s
),
wnba_s3 as (
  select *,
         case when ua_fail then null when not (line > 0) or board_proj is null then 0
              else board_proj / greatest(line, coalesce(min_line, line)) * 50 end cg,
         -- free_top3 (2026-10-17): server wnbaPropScore (api/_dataAccess.js:162-175): projection = prop.projection
         -- ?? player.propProjectionByStat[stat]; null/non-finite projection, line <= 0 or yardage fail => not ranked.
         case when ua_fail or not (line > 0) or coalesce(projection, (e->'propProjectionByStat'->>(p->>'stat'))::numeric) is null then null
              else coalesce(projection, (e->'propProjectionByStat'->>(p->>'stat'))::numeric) / greatest(line, coalesce(min_line, line)) * 50 end srv_score,
         -- previewPlayerProps :390-399: player not started, prop not started / removed / rankEligible=false
         not (coalesce((e->'started') = 'true'::jsonb or (e->'locked') = 'true'::jsonb or (e->'removed') = 'true'::jsonb
           or case when trim(coalesce(e->>'start_time', e->>'startTime', e->>'start_time_utc', e->>'kickoff_at')) ~ '^\d{4}-\d{2}-\d{2}([T ]\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}(:?\d{2})?)?)?$'
                   then trim(coalesce(e->>'start_time', e->>'startTime', e->>'start_time_utc', e->>'kickoff_at'))::timestamptz <= (select ts from cfg)
                   else coalesce(nullif(e->>'game_date', ''), nullif(e->>'gameDate', ''), nullif(e->>'gameday', '')) ~ '^\d{4}-\d{2}-\d{2}$' and coalesce(nullif(e->>'game_date', ''), nullif(e->>'gameDate', ''), nullif(e->>'gameday', '')) < (select et_today from cfg) end, false))
           and not (coalesce((p->'started') = 'true'::jsonb or (p->'locked') = 'true'::jsonb or (p->'removed') = 'true'::jsonb
           or case when trim(coalesce(p->>'start_time', p->>'startTime', p->>'start_time_utc', p->>'kickoff_at')) ~ '^\d{4}-\d{2}-\d{2}([T ]\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}(:?\d{2})?)?)?$'
                   then trim(coalesce(p->>'start_time', p->>'startTime', p->>'start_time_utc', p->>'kickoff_at'))::timestamptz <= (select ts from cfg)
                   else coalesce(nullif(p->>'game_date', ''), nullif(p->>'gameDate', ''), nullif(p->>'gameday', '')) ~ '^\d{4}-\d{2}-\d{2}$' and coalesce(nullif(p->>'game_date', ''), nullif(p->>'gameDate', ''), nullif(p->>'gameday', '')) < (select et_today from cfg) end, false))
           and coalesce((p->'removed') = 'true'::jsonb, false) is false
           and coalesce((p->'rankEligible') = 'false'::jsonb, false) is false as srv_live,
         -- WNBA page (wnba/Dashboard.jsx:430 loads wnba_projections_standard only; :462-468 drops
         -- 'Points - 1st 3 Minutes' and rows with no projection (prop.projection ?? player projX) or no score)
         coalesce(not excluded_from_board and board_proj is not null and line > 0 and not ua_fail, false) as page_visible,
         coalesce((p->>'standardLine') is null or (p->>'standardLine')::numeric = line, false) as std_line_ok,
  -- 2026-10-18b server pool (api/_dataAccess.js shapeForTier): FILTER_STANDARD_BEFORE_FREE_PREVIEW = true, so
  -- filterStandardBoard (src/standardBoard.js isStandardBoardLine: first non-null of odds_type, oddsType, line_type,
  -- lineType, trimmed + lowercased; none => standard) runs first, then prepareMemberBoard -> dropPulledRows
  -- (src/nhl/pointsGate.js: removed === true or pp_status ?? ppStatus in removed|suspended|held|hold|onhold|out|replaced|superseded), THEN ranking.
         coalesce(lower(trim(coalesce(p->>'odds_type', p->>'oddsType', p->>'line_type', p->>'lineType'))), 'standard') = 'standard' as srv_std,
         (coalesce((p->'removed') = 'true'::jsonb, false) or lower(regexp_replace(coalesce(p->>'pp_status', p->>'ppStatus', ''), '[^A-Za-z]', '', 'g')) in ('removed', 'suspended', 'held', 'hold', 'onhold', 'out', 'replaced', 'superseded')) as srv_pulled
  from wnba_s2
),
wnba_srv as (   -- server preview per dataset; only the standard dataset is shown on the WNBA page
  select ot, eo, po, row_number() over (partition by ot order by srv_score desc, eo, po) as srv_rank
  from wnba_s3 where srv_live and srv_score is not null and srv_std and not srv_pulled   -- 2026-10-18b: server pool
),
wnba as (
  select 'WNBA', game_date, e->>'name', e->>'team', coalesce(p->>'opponent', p->>'versus'), p->>'stat', line,
         -- 2026-10-18b: side = src/pickSide.js pickSide(projection, line, wnbaCgScore) (#255, wnba/Dashboard.jsx:529):
         -- no projection/line, floored CG exactly 50, or projection = line => null; else over/under vs the own line
         (select case
           when gated.side is distinct from 'under' then gated.side
           when lower(coalesce(nullif(btrim(ot), ''), 'standard')) in ('demon', 'goblin') then case when (lower(btrim(coalesce(
             nullif(btrim(p->>'allowed_wager_types'), ''),
             nullif(btrim(p->>'allowedWagerTypes'), ''),
             nullif(btrim(p->>'wager_types'), ''),
             nullif(btrim(p->>'wagerTypes'), ''),
             ''))) ~ '(^|[^a-z])(under|less)([^a-z]|$)') then 'under' else null end
           when (lower(btrim(coalesce(
             nullif(btrim(p->>'allowed_wager_types'), ''),
             nullif(btrim(p->>'allowedWagerTypes'), ''),
             nullif(btrim(p->>'wager_types'), ''),
             nullif(btrim(p->>'wagerTypes'), ''),
             ''))) <> '') and not ((lower(btrim(coalesce(
             nullif(btrim(p->>'allowed_wager_types'), ''),
             nullif(btrim(p->>'allowedWagerTypes'), ''),
             nullif(btrim(p->>'wager_types'), ''),
             nullif(btrim(p->>'wagerTypes'), ''),
             ''))) ~ '(^|[^a-z])(under|less)([^a-z]|$)')) then null
           else 'under'
         end
         from (select /* ledger-wager-side */ case when board_proj is null or line is null then null
              when not ua_fail and line > 0 and board_proj::float8 / greatest(line, coalesce(min_line, line))::float8 * 50 = 50 then null
              when board_proj > line then 'over' when board_proj < line then 'under' end as side) gated),
         ot, coalesce(projection, board_proj), round(cg, 2),
         'WNBA Xy() (bundle index-B876gw9W.js): projection / max(own line, minLine[stat]) * 50; minLines 3PA 3.5, 3PM 1.5, Ast 1.5, Blks+Stls 1.5, Blk 0.5, DReb 4.5, FGA 9.5, FGM 4.5, Fantasy 15.5, FTA 3.5, FTM 2.5, Min 33, OReb 0.5, Pts 4.5, PA 7.5, PR 9.5, PRA 10.5, Reb 3.5, RA 5, Stl 1.5, TO 1.5, 2PA 6, 2PM 3.5',
         -- 2026-10-18b: public board only (standard dataset, standard prop, not pulled, shown on the page); else null
         case when page_visible and ot = 'standard' and srv_std and not srv_pulled
              then row_number() over (partition by (page_visible and ot = 'standard' and srv_std and not srv_pulled)
                                      -- float8 score like wnbaCgScore in the page JS (numeric math flipped 1 tie pair on the 10/17 board)
                                      order by board_proj::float8 / greatest(line, coalesce(min_line, line))::float8 * 50 desc, eo, po) end::int,
         ot = 'standard'
           and coalesce((select v.srv_rank from wnba_srv v where v.ot = wnba_s3.ot and v.eo = wnba_s3.eo and v.po = wnba_s3.po) <= 3, false)
           and page_visible and std_line_ok
           and srv_std,
         lock_at, updated_at, 'wnba_projections_' || ot, /* ledger-raw-stamp */ (p || jsonb_build_object('_player', e->>'name', '_team', e->>'team') || jsonb_strip_nulls(jsonb_build_object(
           'allowed_wager_types', nullif(lower(btrim(coalesce(
             nullif(btrim(p || jsonb_build_object('_player', e->>'name', '_team', e->>'team')->>'allowed_wager_types'), ''),
             nullif(btrim(p || jsonb_build_object('_player', e->>'name', '_team', e->>'team')->>'allowedWagerTypes'), ''),
             nullif(btrim(p || jsonb_build_object('_player', e->>'name', '_team', e->>'team')->>'wager_types'), ''),
             nullif(btrim(p || jsonb_build_object('_player', e->>'name', '_team', e->>'team')->>'wagerTypes'), ''),
             ''))), ''),
           'projection_id', nullif(btrim(coalesce(
             p || jsonb_build_object('_player', e->>'name', '_team', e->>'team')->>'projection_id',
             p || jsonb_build_object('_player', e->>'name', '_team', e->>'team')->>'projectionId',
             case when btrim(coalesce(p || jsonb_build_object('_player', e->>'name', '_team', e->>'team')->>'id', '')) ~ '^[0-9]+$' then btrim(p || jsonb_build_object('_player', e->>'name', '_team', e->>'team')->>'id') end,
             ''
           )), '')
         ))),
         case when lock_at is not null
              then 'lock_source=' || lock_source || ': tip ' || to_char(lock_at at time zone 'America/New_York', 'YYYY-MM-DD HH24:MI') || ' ET. '
              else 'lock_source=noon_fallback: no start time on the board or wnba_lineups; lock assumed at 12:00 ET on game date. ' end ||
         'side = pickSide (#255) vs own line: projection = line or floored CG 50 => null (2026-10-18b). board_rank over the public WNBA board (standard, not pulled, shown). free_top3 = WNBA page free top 3: server previewPlayerProps top 3 of the standard board after standard + pulled filters (2026-10-18b; wnbaPropScore, not started/removed/ineligible), minus rows the page hides (1st 3 Min, no projection).'
           || case when projection is null and board_proj is not null then ' projection null; board CG uses player-level proj fallback.' else '' end,
         case when lock_at is not null then lock_at > (select ts from cfg)
              else game_date > (select now_et::date from cfg)
                or (game_date = (select now_et::date from cfg) and (select now_et::time from cfg) < time '12:00') end
  from wnba_s3
),
wnba_lock_sum as (   -- summary column wnba_lock: lock source + ET lock time per game date (noon_fallback logged here)
  select string_agg(x, '; ' order by x) s from (
    select distinct game_date::text || ' ' || lock_source || ' ' ||
           coalesce(to_char(lock_at at time zone 'America/New_York', 'HH24:MI') || ' ET', '12:00 ET assumed') ||
           case when (select count(*) from wnba_games) = 0 then ' (wnba_lineups empty/unreadable)' else '' end x
    from wnba_s) q
),
-- ---------------- KBO ----------------
-- Lock times (fixed 2026-10-12): prefer matchup_data game_time/start_time/first_pitch/time when present;
-- else 18:30 KST weekdays, 14:00 KST weekends + KR public holidays.
-- 2026 postseason (koreabaseball.com / KBO 10/7 release; totalbase.kr): WC 10/14–15 Wed–Thu 18:30;
-- semiPO weekend games 14:00, weekday 18:30. Same pattern as regular season.
kbo_src as (
  select c, p, co, po, (t.data->>'published_at')::timestamptz published_at,
         coalesce((t.data->>'published_at')::timestamptz, (t.data->>'generated_at')::timestamptz) board_ts
  from board_data t,
       jsonb_array_elements(t.data->'cards') with ordinality a(c, co),
       jsonb_array_elements(coalesce(c->'props','[]')) with ordinality b(p, po)
  where t.board = 'prizepicks_props'
),
-- KR public holidays on weekdays during a typical KBO season (2026). Sat/Sun already covered by DOW.
kbo_holidays(d) as (
  values
    (date '2026-03-02'),  -- Independence Movement Day substitute
    (date '2026-05-01'),  -- Labor Day
    (date '2026-05-05'),  -- Children's Day
    (date '2026-05-25'),  -- Buddha's Birthday substitute
    (date '2026-06-03'),  -- Election Day
    (date '2026-08-17'),  -- Liberation Day substitute
    (date '2026-09-24'), (date '2026-09-25'), (date '2026-09-26'),  -- Chuseok
    (date '2026-10-05'),  -- National Foundation Day substitute
    (date '2026-10-09')   -- Hangul Day
),
-- Slate = KST today. Resolve per-matchup lock_at from published game time or weekday/weekend/holiday fallback.
kbo_m as (
  select m,
         (m->>'game_date')::date as game_date,
         nullif(trim(coalesce(m->>'game_time', m->>'start_time', m->>'first_pitch', m->>'time', '')), '') as raw_game_time
  from board_data t, jsonb_array_elements(t.data->'matchups') m
  where t.board = 'matchup_data'
    and (m->>'game_date')::date = (select now_kst::date from cfg)
),
kbo_m2 as (
  select m, game_date, raw_game_time,
         case
           when raw_game_time ~ '^\d{4}-\d{2}-\d{2}' then raw_game_time::timestamptz
           when raw_game_time ~ '^\d{1,2}:\d{2}(:\d{2})?$' then
             ((game_date + (raw_game_time::time))::timestamp at time zone 'Asia/Seoul')
           else null
         end as parsed_start,
         case when extract(dow from game_date) in (0, 6)
                   or exists (select 1 from kbo_holidays h where h.d = game_date)
              then time '14:00' else time '18:30' end as fallback_time
  from kbo_m
),
kbo_m3 as (
  select m, game_date, raw_game_time, parsed_start, fallback_time,
         coalesce(parsed_start, (game_date + fallback_time)::timestamp at time zone 'Asia/Seoul') as lock_at
  from kbo_m2
),
kbo_s as (
  select *, (p->>'line')::numeric line, coalesce((p->>'projection')::numeric, (p->>'avg')::numeric) projection,
         -- 2026-10-18a (PR #253): bounded 0-100 like pipeline/live_formula.py cg_rating (round(min(100, max(0, x)), 1))
         -- and the server's boundCg(rating); a board built before #253 still carries e.g. rating 131.6 => 100.
         -- (Bounded in kbo_s2, not here: greatest(0, NULL) is 0 in Postgres, which would turn "no score" into 0.)
         coalesce((p->>'rating')::numeric, round((p->>'projection')::numeric/nullif((p->>'line')::numeric,0)*50,1)) site_score,
         (select k.lock_at from kbo_m3 k
           where c->>'name' in (k.m->'away_pitcher'->>'name', k.m->'home_pitcher'->>'name')
              or exists (select 1 from jsonb_array_elements(coalesce(k.m->'props','[]')) mp where mp->>'name' = c->>'name')
              or (array[c->>'team', c->>'opponent'] <@ array[k.m->>'away', k.m->>'home'])
           order by k.lock_at nulls last
           limit 1) as start_time,
         exists (select 1 from kbo_m3 k where c->>'name' in (k.m->'away_pitcher'->>'name', k.m->'home_pitcher'->>'name')
                    or exists (select 1 from jsonb_array_elements(coalesce(k.m->'props','[]')) mp where mp->>'name' = c->>'name')
                    or (array[c->>'team', c->>'opponent'] <@ array[k.m->>'away', k.m->>'home'])) in_slate
  from kbo_src
),
-- Board-level staleness (fixed 2026-10-12): the board is stale only if its published_at (fallback
-- generated_at), in KST, is before the slate date, or none of its players are in that date's matchup_data.
-- Lines repeating from earlier graded days are NOT a staleness signal (old graded-pairs / last-log rule removed).
kbo_board as (
  select coalesce(bool_or(board_ts is null or (board_ts at time zone 'Asia/Seoul')::date < (select now_kst::date from cfg))
                  or not bool_or(in_slate), false) stale
  from kbo_s
),
kbo_s2 as (
  select *, case when (p->>'stat') ~* '\y(yards?|yds?)\y' and line <= 0.5 then null
                 when site_score is not null then least(100, greatest(0, site_score))
                 when line > 0 and projection is not null then least(100, greatest(0, projection / line * 50)) end cg,
         -- free_top3 (2026-10-17): server previewPrizepicks (api/_dataAccess.js:365-387) ranks by kboPropScore
         -- over standard, not-pulled props only (2026-10-18b: filterStandardBoard + dropPulledRows run first)
         -- (:146-149 -> src/kboBoardScore.js scoreFor): prop.projection only (no avg / rating / cg_projection
         -- fallback), yardage rule, cgScore = projection / line * 50 (line <= 0 => 0).
         case when (p->>'stat') ~* '\y(yards?|yds?)\y' and not (coalesce(line, 0) > 0.5) then null
              when jsonb_typeof(p->'projection') = 'number'
                or (jsonb_typeof(p->'projection') = 'string' and trim(p->>'projection') ~ '^-?\d+(\.\d+)?$')
                then least(100, greatest(0, case when line > 0 then trim(p->>'projection')::float8 / line::float8 * 50 else 0 end)) end srv_score,   -- 2026-10-18a: scoreFor = boundCg(cgScore), float8 like the site JS
         -- card not started (:370) and propStillLive (:245-247): prop not started / removed / rankEligible=false
         not (coalesce((c->'started') = 'true'::jsonb or (c->'locked') = 'true'::jsonb or (c->'removed') = 'true'::jsonb
           or case when trim(coalesce(c->>'start_time', c->>'startTime', c->>'start_time_utc', c->>'kickoff_at')) ~ '^\d{4}-\d{2}-\d{2}([T ]\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}(:?\d{2})?)?)?$'
                   then trim(coalesce(c->>'start_time', c->>'startTime', c->>'start_time_utc', c->>'kickoff_at'))::timestamptz <= (select ts from cfg)
                   else coalesce(nullif(c->>'game_date', ''), nullif(c->>'gameDate', ''), nullif(c->>'gameday', '')) ~ '^\d{4}-\d{2}-\d{2}$' and coalesce(nullif(c->>'game_date', ''), nullif(c->>'gameDate', ''), nullif(c->>'gameday', '')) < (select et_today from cfg) end, false))
           and not (coalesce((p->'started') = 'true'::jsonb or (p->'locked') = 'true'::jsonb or (p->'removed') = 'true'::jsonb
           or case when trim(coalesce(p->>'start_time', p->>'startTime', p->>'start_time_utc', p->>'kickoff_at')) ~ '^\d{4}-\d{2}-\d{2}([T ]\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}(:?\d{2})?)?)?$'
                   then trim(coalesce(p->>'start_time', p->>'startTime', p->>'start_time_utc', p->>'kickoff_at'))::timestamptz <= (select ts from cfg)
                   else coalesce(nullif(p->>'game_date', ''), nullif(p->>'gameDate', ''), nullif(p->>'gameday', '')) ~ '^\d{4}-\d{2}-\d{2}$' and coalesce(nullif(p->>'game_date', ''), nullif(p->>'gameDate', ''), nullif(p->>'gameday', '')) < (select et_today from cfg) end, false))
           and coalesce((p->'removed') = 'true'::jsonb, false) is false
           and coalesce((p->'rankEligible') = 'false'::jsonb, false) is false as srv_live,
  -- 2026-10-18b server pool (api/_dataAccess.js shapeForTier): FILTER_STANDARD_BEFORE_FREE_PREVIEW = true, so
  -- filterStandardBoard (src/standardBoard.js isStandardBoardLine: first non-null of odds_type, oddsType, line_type,
  -- lineType, trimmed + lowercased; none => standard) runs first, then prepareMemberBoard -> dropPulledRows
  -- (src/nhl/pointsGate.js: removed === true or pp_status ?? ppStatus in removed|suspended|held|hold|onhold|out|replaced|superseded), THEN ranking.
         coalesce(lower(trim(coalesce(p->>'odds_type', p->>'oddsType', p->>'line_type', p->>'lineType'))), 'standard') = 'standard' as srv_std,
         (coalesce((p->'removed') = 'true'::jsonb, false) or lower(regexp_replace(coalesce(p->>'pp_status', p->>'ppStatus', ''), '[^A-Za-z]', '', 'g')) in ('removed', 'suspended', 'held', 'hold', 'onhold', 'out', 'replaced', 'superseded')) as srv_pulled
  from kbo_s
),
kbo_srv as (   -- server preview: top 3 standard, not-pulled props across all cards (2026-10-18b), board order breaks ties
  select co, po, row_number() over (order by srv_score desc, co, po) as srv_rank
  from kbo_s2 where srv_live and srv_score is not null and srv_std and not srv_pulled
),
kbo as (
  select 'KBO', (select now_kst::date from cfg), c->>'name', c->>'team', c->>'opponent', p->>'stat', line,
         -- 2026-10-18a: exactly 50 is neutral (cgSide null) => no side, whatever the recommendation says
         (select case
           when gated.side is distinct from 'under' then gated.side
           when lower(coalesce(nullif(btrim(p->>'odds_type'), ''), 'standard')) in ('demon', 'goblin') then case when (lower(btrim(coalesce(
             nullif(btrim(p->>'allowed_wager_types'), ''),
             nullif(btrim(p->>'allowedWagerTypes'), ''),
             nullif(btrim(p->>'wager_types'), ''),
             nullif(btrim(p->>'wagerTypes'), ''),
             ''))) ~ '(^|[^a-z])(under|less)([^a-z]|$)') then 'under' else null end
           when (lower(btrim(coalesce(
             nullif(btrim(p->>'allowed_wager_types'), ''),
             nullif(btrim(p->>'allowedWagerTypes'), ''),
             nullif(btrim(p->>'wager_types'), ''),
             nullif(btrim(p->>'wagerTypes'), ''),
             ''))) <> '') and not ((lower(btrim(coalesce(
             nullif(btrim(p->>'allowed_wager_types'), ''),
             nullif(btrim(p->>'allowedWagerTypes'), ''),
             nullif(btrim(p->>'wager_types'), ''),
             nullif(btrim(p->>'wagerTypes'), ''),
             ''))) ~ '(^|[^a-z])(under|less)([^a-z]|$)')) then null
           else 'under'
         end
         from (select /* ledger-wager-side */ case when cg = 50 then null else case upper(p->>'recommendation') when 'OVER' then 'over' when 'UNDER' then 'under' end end as side) gated),
         p->>'odds_type', projection, round(cg, 2),
         'KBO: prop rating (= site CG Score, projection/line*50; cg_projection is NOT the CG Score, fixed 2026-10-16), fallback projection/line*50; bounded 0-100 (PR #253, 2026-10-18a); 50 = neutral, side null',
         -- 2026-10-18b: public board only (standard, not pulled); demon/goblin/pulled => null
         case when srv_std and not srv_pulled
              then row_number() over (partition by (srv_std and not srv_pulled) order by cg desc nulls last, co, po) end::int,
         -- KBO page free top 3 (KboApp.jsx:36-38 'board' self-gates; KboPropBoard.jsx:221,240-269 shows every row
         -- the server sends, no line-type filter) restricted to standard lines (2026-10-17 rule)
         coalesce((select v.srv_rank from kbo_srv v where v.co = kbo_s2.co and v.po = kbo_s2.po) <= 3, false)
           and srv_std,
         start_time, published_at, 'prizepicks_props', /* ledger-raw-stamp */ (p || jsonb_build_object('_player', c->>'name') || jsonb_strip_nulls(jsonb_build_object(
           'allowed_wager_types', nullif(lower(btrim(coalesce(
             nullif(btrim(p || jsonb_build_object('_player', c->>'name')->>'allowed_wager_types'), ''),
             nullif(btrim(p || jsonb_build_object('_player', c->>'name')->>'allowedWagerTypes'), ''),
             nullif(btrim(p || jsonb_build_object('_player', c->>'name')->>'wager_types'), ''),
             nullif(btrim(p || jsonb_build_object('_player', c->>'name')->>'wagerTypes'), ''),
             ''))), ''),
           'projection_id', nullif(btrim(coalesce(
             p || jsonb_build_object('_player', c->>'name')->>'projection_id',
             p || jsonb_build_object('_player', c->>'name')->>'projectionId',
             case when btrim(coalesce(p || jsonb_build_object('_player', c->>'name')->>'id', '')) ~ '^[0-9]+$' then btrim(p || jsonb_build_object('_player', c->>'name')->>'id') end,
             ''
           )), '')
         ))),
         'lock = matchup_data game_time/start_time/first_pitch/time if set, else 18:30 KST weekdays / 14:00 KST weekends+KR holidays. side from site recommendation only (PUSH/none => null). free_top3 (2026-10-17 rule) = KBO page free top 3: server previewPrizepicks top 3 over standard, not-pulled props (2026-10-18b; projection/line*50 bounded, not started/removed/ineligible). board_rank over the public KBO board (standard, not pulled; else null).'
           || case when p->>'projection' is null then ' projection null on board; site CG Score falls back to season avg/line*50.' else '' end,
         start_time is not null
           and start_time > (select ts from cfg)
           and not (select stale from kbo_board)
           and in_slate   -- per-card: player not in today's matchup_data => skip (e.g. leftover card)
  from kbo_s2
),
allrows (sport, slate_date, player, team, opponent, prop, line, side, odds_type, projection, cg_score,
         cg_score_method, board_rank, free_top3, start_time, published_at, source_table, raw, notes, pre_lock) as (
  select * from nfl union all select * from nhl union all select * from wnba union all select * from kbo
),
ins as (
  insert into public.qa_pick_ledger
    (sport, slate_date, player, team, opponent, prop, line, side, odds_type, projection, cg_score,
     cg_score_method, board_rank, free_top3, start_time, published_at, source_table, raw, notes)
  select sport, slate_date, player, team, opponent, prop, line, side, odds_type, projection, cg_score,
         cg_score_method, board_rank, free_top3, start_time, published_at, source_table, raw, notes
  from allrows
  where pre_lock and player is not null and prop is not null and line is not null
  on conflict on constraint qa_pick_ledger_pick_uniq do nothing
  returning sport, free_top3
)
-- Light-run summary (2026-10-17): same snapshot + insert as snapshot.sql, plus freshness stats computed from the
-- boards already read above (no extra queries). Window = games starting in the next 8 h.
, bsport as (
  select case when bd.board like 'wnba%' then 'WNBA' when bd.board like 'nfl%' then 'NFL' when bd.board like 'nhl%' then 'NHL' else 'KBO' end sport,
         bd.board, bd.updated_at
  from board_data bd
  where bd.board not in ('nfl_lineups', 'matchup_data', 'wnba_lineups')
),
win as (
  select a.* from allrows a, cfg
  where a.start_time > cfg.ts and a.start_time <= cfg.ts + interval '8 hours'
)
select a.sport,
       count(*)                                         as on_board,
       count(*) filter (where a.pre_lock)               as pre_lock,
       count(*) filter (where not a.pre_lock)           as missed_post_lock,
       (select count(*) from ins i where i.sport = a.sport) as inserted,
       (select string_agg(x.player || ' ' || x.prop || ' ' || x.line || coalesce(' ' || x.odds_type, '') || ' (CG ' || x.cg_score || case when x.pre_lock then '' else ', POST-LOCK' end || ')', '; ' order by x.cg_score desc)
          from allrows x where x.sport = a.sport and x.free_top3) as free_top3,
       (select stale from kbo_board) as kbo_board_stale,
       (select string_agg(be.board || ': ' || be.err, '; ' order by be.board) from board_errors be
         where case when be.board like 'wnba%' then 'WNBA' when be.board like 'nfl%' then 'NFL' when be.board like 'nhl%' then 'NHL' else 'KBO' end = a.sport) as board_error,
       (select string_agg(b.board || ' ' || to_char(b.updated_at at time zone 'America/New_York', 'MM-DD HH24:MI'), '; ' order by b.board) from bsport b where b.sport = a.sport) as board_updated_et,
       count(*) filter (where a.projection is null)     as missing_proj,
       count(*) filter (where a.line is null or a.line <= 0) as bad_lines,
       count(*) - count(distinct (a.player, a.prop, a.line, coalesce(a.odds_type, ''), a.start_time)) as dupes,
       to_char(min(a.start_time) filter (where a.start_time > (select ts from cfg)) at time zone 'America/New_York', 'MM-DD HH24:MI') as next_start_et,
       (select count(distinct (least(coalesce(w.team,''), coalesce(w.opponent,'')), greatest(coalesce(w.team,''), coalesce(w.opponent,'')), w.start_time)) from win w where w.sport = a.sport) as games_8h,
       (select string_agg(distinct least(coalesce(w.team,''), coalesce(w.opponent,'')) || '-' || greatest(coalesce(w.team,''), coalesce(w.opponent,'')) || ' ' || to_char(w.start_time at time zone 'America/New_York', 'HH24:MI'), '; ') from win w where w.sport = a.sport) as games_8h_list,
       (select count(*) from win w where w.sport = a.sport) as props_8h,
       (select count(*) from win w where w.sport = a.sport and w.projection is null) as missing_proj_8h,
       (select string_agg(distinct w.player || ' (' || coalesce(w.team, '?') || ')', ', ') from win w where w.sport = a.sport) as players_8h,
       case when a.sport = 'WNBA' then (select s from wnba_lock_sum) end as wnba_lock
from allrows a
group by a.sport
union all
select e.sport, 0, 0, 0, 0, null, (select stale from kbo_board), string_agg(e.board || ': ' || e.err, '; ' order by e.board),
       null, null, null, null, null, null, null, null, null, null, null
from (select be.*, case when be.board like 'wnba%' then 'WNBA' when be.board like 'nfl%' then 'NFL' when be.board like 'nhl%' then 'NHL' else 'KBO' end sport
      from board_errors be) e
where not exists (select 1 from allrows a2 where a2.sport = e.sport)
group by e.sport
order by 1;

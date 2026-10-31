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
-- Reads (SELECT only): nfl_projections, nhl_projections, wnba_projections_{standard,demon,goblin},
--                      prizepicks_props, graded_props_history (no longer used by KBO), matchup_data
--   All board tables are read through board_data (id = 1 + the chunk ids its manifest names; PR #198 format).
--   A board whose chunk set is incomplete/mixed contributes no rows; its reason is in the board_error column.
-- Writes: INSERT into qa_pick_ledger only (ON CONFLICT DO NOTHING => re-runnable, never duplicates).
-- Lock rule: only picks whose game has NOT started are inserted. Started picks are counted as
--            missed_post_lock in the summary output and never inserted.
-- CG Score methods mirror cgpropz.com bundle /assets/index-B876gw9W.js (re-verified 2026-10-11 2:25 PM ET after PR #112). See README.md.
-- Unique key includes cg_score + free_top3: a rescore inserts a new row; an identical repeat does not.
with
cfg as (
  select now() as ts,
         (now() at time zone 'America/New_York') as now_et,
         (now() at time zone 'Asia/Seoul')      as now_kst
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
board_req(board) as (values ('prizepicks_props'), ('matchup_data')),
board_heads as (
  select 'nfl_projections'::text board, h.id, h.data, h.updated_at from public.nfl_projections h where false
  union all select 'nhl_projections'::text board, h.id, h.data, h.updated_at from public.nhl_projections h where false
  union all select 'wnba_projections_standard'::text board, h.id, h.data, h.updated_at from public.wnba_projections_standard h where false
  union all select 'wnba_projections_demon'::text board, h.id, h.data, h.updated_at from public.wnba_projections_demon h where false
  union all select 'wnba_projections_goblin'::text board, h.id, h.data, h.updated_at from public.wnba_projections_goblin h where false
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
    where false and c.id in (select i.id from board_ids i where i.board = 'nfl_projections' and i.id is not null)
  union all select 'nhl_projections'::text board, c.id, c.data, c.updated_at from public.nhl_projections c
    where false and c.id in (select i.id from board_ids i where i.board = 'nhl_projections' and i.id is not null)
  union all select 'wnba_projections_standard'::text board, c.id, c.data, c.updated_at from public.wnba_projections_standard c
    where false and c.id in (select i.id from board_ids i where i.board = 'wnba_projections_standard' and i.id is not null)
  union all select 'wnba_projections_demon'::text board, c.id, c.data, c.updated_at from public.wnba_projections_demon c
    where false and c.id in (select i.id from board_ids i where i.board = 'wnba_projections_demon' and i.id is not null)
  union all select 'wnba_projections_goblin'::text board, c.id, c.data, c.updated_at from public.wnba_projections_goblin c
    where false and c.id in (select i.id from board_ids i where i.board = 'wnba_projections_goblin' and i.id is not null)
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
           when 'Rush Yards' then 5.5 when 'Rush+Rec Yds' then 30.5 end as floor_line
  from nfl_src
),
nfl_s as (
  select *, case when ga_ok and line > 0 and projection is not null
                 then projection / greatest(line, coalesce(floor_line, line)) * 50 end as cg
  from nfl_c
),
nfl as (
  select 'NFL'::text sport, gameday slate_date, player, team, opponent, prop, line,
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
         from (select /* ledger-wager-side */ case when projection >= line then 'over' else 'under' end as side) gated) side,
         null::text odds_type, projection, round(cg, 2) cg_score,
         'NFL Ag(): projection / max(line, floor[prop]) * 50; floors PassAtt 28.5, PassCmp 18, PassTD 1, PassYds 186.5, Pass+RushYds 210.5, RecTgt 2, RecYds 5.5, Rec 1.5, RushAtt 2.5, RushYds 5.5, Rush+RecYds 30.5; yardage lines <=0.5 excluded (null)' cg_score_method,
         case when cg is not null then row_number() over (partition by (cg is not null) order by cg desc, ord) end board_rank,
         false free_top3,   -- free preview has an NFL tab (Tv) but /api/data free tier returns data=[] for NFL (checked 2026-10-11 2:25 PM ET)
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
         'side = site isOver rule (projection >= line). board_rank over full NFL board incl. started games.' notes,
         start_time > (select ts from cfg) as pre_lock
  from nfl_s
),
-- ---------------- NHL ----------------
nhl_src as (
  select e, ord, coalesce((t.data->0->>'generated_at')::timestamptz, t.updated_at) updated_at
  from board_data t, jsonb_array_elements(t.data) with ordinality x(e, ord)
  where t.board = 'nhl_projections'
),
nhl_s as (
  select e, ord, updated_at, (e->>'line')::numeric line, (e->>'projection')::numeric projection,
         (e->>'start_time')::timestamptz start_time,
         case when (e->>'line')::numeric > 0 then coalesce((e->>'projection')::numeric, 0) / (e->>'line')::numeric * 50 else 0 end cg,
         coalesce((e->>'rankEligible')::boolean, true) elig
  from nhl_src
),
nhl as (
  select 'NHL', (start_time at time zone 'America/New_York')::date, e->>'player', e->>'team', e->>'opponent', e->>'prop', line,
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
         from (select /* ledger-wager-side */ case when projection >= line then 'over' else 'under' end as side) gated),
         e->>'oddsType', projection, round(cg, 2),
         'NHL ec(): projection / line * 50 (board ranks rankEligible=false last)',
         row_number() over (order by (not elig), cg desc, ord)::int,
         row_number() over (order by cg desc, ord) <= 3,
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
         'side = site isOver rule (projection >= line). free_top3/board_rank over full NHL board.',
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
wnba_s as (
  select *, (p->>'line')::numeric line, coalesce((p->>'standardLine')::numeric, (p->>'line')::numeric) disp_line,
         (p->>'projection')::numeric projection, (p->>'gameDate')::date game_date
  from wnba_src
),
wnba_s2 as (
  -- Site bundle /assets/index-B876gw9W.js (PR #112, re-verified 2026-10-11 2:25 PM ET):
  --   Xy(proj, prop) = proj / max(prop.line, cA[stat]) * 50, scored against the row's OWN line
  --   (demon/goblin no longer use standardLine). Yardage-stat lines <= 0.5 => null.
  --   Board (ZC): projection ?? player-level proj (VC), "Points - 1st 3 Minutes" excluded.
  --   Free preview (GA): standard board only, projection as-is (null => 0), all stats incl. 1st 3 Min.
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
         case when ua_fail then null when not (line > 0) then 0
              else coalesce(projection, 0) / greatest(line, coalesce(min_line, line)) * 50 end preview_score
  from wnba_s2
),
wnba as (
  select 'WNBA', game_date, e->>'name', e->>'team', coalesce(p->>'opponent', p->>'versus'), p->>'stat', line,
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
         from (select /* ledger-wager-side */ case when coalesce(projection, board_proj) >= line then 'over' else 'under' end as side) gated),
         ot, coalesce(projection, board_proj), round(cg, 2),
         'WNBA Xy() (bundle index-B876gw9W.js): projection / max(own line, minLine[stat]) * 50; minLines 3PA 3.5, 3PM 1.5, Ast 1.5, Blks+Stls 1.5, Blk 0.5, DReb 4.5, FGA 9.5, FGM 4.5, Fantasy 15.5, FTA 3.5, FTM 2.5, Min 33, OReb 0.5, Pts 4.5, PA 7.5, PR 9.5, PRA 10.5, Reb 3.5, RA 5, Stl 1.5, TO 1.5, 2PA 6, 2PM 3.5',
         case when not excluded_from_board and cg is not null then row_number() over (partition by ot, (excluded_from_board or cg is null) order by cg desc, eo, po) end::int,
         ot = 'standard' and preview_score is not null
           and row_number() over (partition by ot, (preview_score is null) order by preview_score desc, eo, po) <= 3,
         null::timestamptz, updated_at, 'wnba_projections_' || ot, /* ledger-raw-stamp */ (p || jsonb_build_object('_player', e->>'name', '_team', e->>'team') || jsonb_strip_nulls(jsonb_build_object(
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
         'start_time not published; lock assumed at 12:00 ET on game date. side = isOver rule vs own line. free_top3 = site GA() preview rule (standard board, all stats).'
           || case when projection is null and board_proj is not null then ' projection null; board CG uses player-level proj fallback.' else '' end,
         game_date > (select now_et::date from cfg)
           or (game_date = (select now_et::date from cfg) and (select now_et::time from cfg) < time '12:00')
  from wnba_s3
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
         -- 2026-10-18b: public board = standard, not pulled (same rule as snapshot.sql)
         coalesce(lower(trim(coalesce(p->>'odds_type', p->>'oddsType', p->>'line_type', p->>'lineType'))), 'standard') = 'standard' as srv_std,
         (coalesce((p->'removed') = 'true'::jsonb, false) or lower(regexp_replace(coalesce(p->>'pp_status', p->>'ppStatus', ''), '[^A-Za-z]', '', 'g')) in ('removed', 'suspended', 'held', 'hold', 'onhold', 'out', 'replaced', 'superseded')) as srv_pulled
  from kbo_s
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
         case when srv_std and not srv_pulled
              then row_number() over (partition by (srv_std and not srv_pulled) order by cg desc nulls last, co, po) end::int,   -- 2026-10-18b
         null::boolean,   -- KBO free top-3 is chosen server-side by /api/data (not reproducible from client JS); unknown
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
         'lock = matchup_data game_time/start_time/first_pitch/time if set, else 18:30 KST weekdays / 14:00 KST weekends+KR holidays. side from site recommendation only (PUSH/none => null). free_top3 unknown (server-side preview).'
           || case when p->>'projection' is null then ' projection null on board; site CG Score falls back to season avg/line*50.' else '' end,
         start_time is not null
           and start_time > (select ts from cfg)
           and not (select stale from kbo_board)
           and in_slate   -- per-card: player not in today's matchup_data => skip (e.g. leftover card)
  from kbo_s2
),
allrows (sport, slate_date, player, team, opponent, prop, line, side, odds_type, projection, cg_score,
         cg_score_method, board_rank, free_top3, start_time, published_at, source_table, raw, notes, pre_lock) as (
  select * from kbo
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
select a.sport,
       count(*)                                         as on_board,
       count(*) filter (where a.pre_lock)               as pre_lock,
       count(*) filter (where not a.pre_lock)           as missed_post_lock,
       (select count(*) from ins i where i.sport = a.sport) as inserted,
       (select string_agg(x.player || ' ' || x.prop || ' ' || x.line || coalesce(' ' || x.odds_type, '') || ' (CG ' || x.cg_score || case when x.pre_lock then '' else ', POST-LOCK' end || ')', '; ' order by x.cg_score desc)
          from allrows x where x.sport = a.sport and x.free_top3) as free_top3,
       (select stale from kbo_board) as kbo_board_stale,
       (select string_agg(be.board || ': ' || be.err, '; ' order by be.board) from board_errors be
         where case when be.board like 'wnba%' then 'WNBA' when be.board like 'nfl%' then 'NFL' when be.board like 'nhl%' then 'NHL' else 'KBO' end = a.sport) as board_error
from allrows a
group by a.sport
union all
-- a rejected board snapshots nothing; when its sport has no rows at all, still report the error
select e.sport, 0, 0, 0, 0, null, (select stale from kbo_board), string_agg(e.board || ': ' || e.err, '; ' order by e.board)
from (select be.*, case when be.board like 'wnba%' then 'WNBA' when be.board like 'nfl%' then 'NFL' when be.board like 'nhl%' then 'NHL' else 'KBO' end sport
      from board_errors be) e
where not exists (select 1 from allrows a2 where a2.sport = e.sport)
group by e.sport
order by 1;

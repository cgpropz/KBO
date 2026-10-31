"""Unapplied snapshot SQL for the ledger side rule.

patch_snapshot_sql wraps each sport's existing side expression. It does not
add a function, grant, table, or policy. Running it twice does not wrap twice.
The files under sql/qa/unapplied/ are the result. Nothing here is applied.
"""
from __future__ import annotations

SENTINEL = "/* ledger-wager-side */"
RAW_SENTINEL = "/* ledger-raw-stamp */"

BANNER_WRITE = """-- ============================================================================
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
"""

BANNER_READ = """-- ============================================================================
-- NOT APPLIED. Read-only. Cloud agents and CI must not run this file.
-- No INSERT, UPDATE, DELETE, function, grant, table, or RLS policy.
-- Do not point it at Supabase project KBO_2026 (ocaqjkfdjqxszevtllew)
-- from a cloud agent. Code Green may run it after review; it does not
-- change schema, so it is not a CLEAR migration.
-- ============================================================================
"""


def _odds_from_row(alias: str) -> str:
    return (
        "lower(coalesce(nullif(btrim(coalesce("
        f"{alias}->>'odds_type', {alias}->>'oddsType', "
        f"{alias}->>'line_type', {alias}->>'lineType')), ''), 'standard'))"
    )


def wager_expr(raw_sql: str) -> str:
    """First non-blank wager token.

    An empty or missing allowed_wager_types falls through. wagerTypes is
    the last fallback. coalesce keeps '', so each key is nullif'd first.
    """
    keys = ("allowed_wager_types", "allowedWagerTypes", "wager_types", "wagerTypes")
    parts = ",\n".join(f"             nullif(btrim({raw_sql}->>'{key}'), '')" for key in keys)
    return f"lower(btrim(coalesce(\n{parts},\n             '')))"


def wrap_side(proposed_sql: str, odds_sql: str, raw_sql: str) -> str:
    """SQL for gate_under around the sport's existing side expression.

    The proposed expression appears once, right after the sentinel, so a
    second pass does not wrap it again.
    """
    wager = wager_expr(raw_sql)
    allows = f"({wager} ~ '(^|[^a-z])(under|less)([^a-z]|$)')"
    present = f"({wager} <> '')"
    return (
        "(select case\n"
        "           when gated.side is distinct from 'under' then gated.side\n"
        f"           when {odds_sql} in ('demon', 'goblin') then case when {allows} then 'under' else null end\n"
        f"           when {present} and not ({allows}) then null\n"
        "           else 'under'\n"
        "         end\n"
        f"         from (select {SENTINEL} {proposed_sql} as side) gated)"
    )


def stamp_sql(raw_sql: str) -> str:
    """jsonb raw plus canonical allowed_wager_types and projection_id."""
    return (
        f"({raw_sql} || jsonb_strip_nulls(jsonb_build_object(\n"
        f"           'allowed_wager_types', nullif({wager_expr(raw_sql)}, ''),\n"
        "           'projection_id', nullif(btrim(coalesce(\n"
        f"             {raw_sql}->>'projection_id',\n"
        f"             {raw_sql}->>'projectionId',\n"
        f"             case when btrim(coalesce({raw_sql}->>'id', '')) ~ '^[0-9]+$' then btrim({raw_sql}->>'id') end,\n"
        "             ''\n"
        "           )), '')\n"
        "         )))"
    )


def _replace_unguarded(text: str, old: str, new: str, sentinel: str = SENTINEL) -> tuple[str, int]:
    out = []
    start = 0
    count = 0
    while True:
        found = text.find(old, start)
        if found < 0:
            out.append(text[start:])
            break
        window = text[max(0, found - 160):found]
        if sentinel in window:
            out.append(text[start:found + len(old)])
            start = found + len(old)
            continue
        out.append(text[start:found])
        out.append(new)
        start = found + len(old)
        count += 1
    return "".join(out), count


# (exact existing side expression, odds sql, raw sql used for the wager field)
SIDE_RULES = (
    (
        "case when cg > 50 then 'over' when cg < 50 then 'under' end",
        _odds_from_row("e"),
        "e",
    ),
    (
        "case when projection is null or line is null then null\n"
        "              when line_ok and line > 0 and projection::float8 / line::float8 * 50 = 50 then null\n"
        "              when projection > line then 'over' when projection < line then 'under' end",
        _odds_from_row("e"),
        "e",
    ),
    (
        "case when board_proj is null or line is null then null\n"
        "              when not ua_fail and line > 0 and board_proj::float8 / greatest(line, coalesce(min_line, line))::float8 * 50 = 50 then null\n"
        "              when board_proj > line then 'over' when board_proj < line then 'under' end",
        "lower(coalesce(nullif(btrim(ot), ''), 'standard'))",
        "p",
    ),
    (
        "case when cg = 50 then null else case upper(p->>'recommendation') when 'OVER' then 'over' when 'UNDER' then 'under' end end",
        "lower(coalesce(nullif(btrim(p->>'odds_type'), ''), 'standard'))",
        "p",
    ),
    (
        "case when projection >= line then 'over' else 'under' end",
        _odds_from_row("e"),
        "e",
    ),
    (
        "case when coalesce(projection, board_proj) >= line then 'over' else 'under' end",
        "lower(coalesce(nullif(btrim(ot), ''), 'standard'))",
        "p",
    ),
)

# The matched text includes the column in front of the raw expression so the
# copy inside stamp_sql (which repeats that expression) is not matched again.
RAW_RULES = (
    (
        "'nfl_projections' source_table, e raw,",
        "'nfl_projections' source_table, {stamped} raw,",
        "e",
    ),
    (
        "'nhl_projections', e,",
        "'nhl_projections', {stamped},",
        "e",
    ),
    (
        "'wnba_projections_' || ot, p || jsonb_build_object('_player', e->>'name', '_team', e->>'team'),",
        "'wnba_projections_' || ot, {stamped},",
        "p || jsonb_build_object('_player', e->>'name', '_team', e->>'team')",
    ),
    (
        "'prizepicks_props', p || jsonb_build_object('_player', c->>'name'),",
        "'prizepicks_props', {stamped},",
        "p || jsonb_build_object('_player', c->>'name')",
    ),
)


def patch_snapshot_sql(text: str) -> tuple[str, dict]:
    """Return (patched sql, counts). Idempotent once the sentinel is in place."""
    counts = {"sides": 0, "raws": 0}
    for proposed, odds_sql, raw_sql in SIDE_RULES:
        text, n = _replace_unguarded(text, proposed, wrap_side(proposed, odds_sql, raw_sql))
        counts["sides"] += n
    for old, template, raw_sql in RAW_RULES:
        replacement = template.format(stamped=f"{RAW_SENTINEL} {stamp_sql(raw_sql)}")
        text, n = _replace_unguarded(text, old, replacement, RAW_SENTINEL)
        counts["raws"] += n
    return text, counts


def with_banner(text: str) -> str:
    if "NOT APPLIED" in text[:800]:
        return text
    banner = BANNER_WRITE if "insert into public.qa_pick_ledger" in text.lower() else BANNER_READ
    return banner + text


ALL_LINES_SQL = """-- ============================================================================
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
"""

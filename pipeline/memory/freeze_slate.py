#!/usr/bin/env python3
"""Freeze/merge live prop boards into memory/<sport>/mm/dd/yyyy/slate.json.

Only PREGAME props are frozen: a prop whose game has started (per
pipeline/memory/cutoff.py) is never added or updated, so a slate always holds
the last pregame view of each prop. Graded (locked) days are never touched.
"""
from __future__ import annotations

import argparse
import json
import re
import sys
from collections import defaultdict
from datetime import date, datetime
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[2]))

from pipeline.memory import cutoff
from pipeline.memory.common import (
    PUBLIC_DATA,
    REPO_ROOT,
    SLATE_PROP_SCHEMA,
    ensure_memory_dir,
    format_iso,
    format_mmddyyyy,
    kst_game_date_from_meta,
    load_json,
    memory_dir,
    normalize_name,
    parse_cli_date,
    parse_date,
    prop_key,
    source_commit,
    today_et,
    today_kst,
)
from pipeline.memory.common import write_slate as _write_slate_unlocked


def slate_is_locked(sport: str, d: date) -> bool:
    """True once a day has been graded complete (recap.json + meta complete).

    Locked slates are immutable: re-freezing after grading would let
    post-game projections/recommendations overwrite the pregame picks the
    recap was graded against.
    """
    day_dir = memory_dir(sport, d)
    meta = load_json(day_dir / "meta.json", default={}) or {}
    return meta.get("status") == "complete" and (day_dir / "recap.json").exists()


def write_slate(sport: str, d: date, props: list[dict], *, source: str | None = None) -> Path:
    """common.write_slate, except graded (locked) days are never touched."""
    if slate_is_locked(sport, d):
        return memory_dir(sport, d) / "slate.json"
    return _write_slate_unlocked(sport, d, props, source=source)


def _now(now: datetime | None) -> datetime:
    return now or cutoff.utc_now()


def _stamp(prop: dict, start: datetime, start_source: str, now: datetime, commit: str | None) -> dict:
    """Timing + provenance fields shared by every sport (schema 2)."""
    now_iso = cutoff.to_utc_iso(now)
    prop.update(
        {
            "projection_schema": SLATE_PROP_SCHEMA,
            "start_time_utc": cutoff.to_utc_iso(start),
            "start_time_source": start_source,
            "first_frozen_at": now_iso,  # merge keeps the first value
            "last_pregame_frozen_at": now_iso,
            "source_commit": commit,
        }
    )
    return prop


def _edge(projection, line):
    try:
        return round(float(projection) - float(line), 3)
    except (TypeError, ValueError):
        return None


# ── KBO ─────────────────────────────────────────────────────────────────────

KBO_PITCHER_STAT_TO_PROP = {
    "Pitcher Strikeouts": "Strikeouts",
    "Strikeouts": "Strikeouts",
    "Pitching Outs": "Pitching Outs",
    "Hits Allowed": "Hits Allowed",
    "Pitcher Hits Allowed": "Hits Allowed",
}
KBO_BATTER_STAT_ALIASES = {
    "Hitter Fantasy Score": ("Hitter Fantasy Score", "Fantasy Score"),
    "Fantasy Score": ("Fantasy Score", "Hitter Fantasy Score"),
}
KBO_PITCHER_FACTOR_FIELDS = (
    "so_per_ip",
    "ip_per_g",
    "whip",
    "opp_factor",
    "whip_factor",
    "form_factor",
    "opp_so_per_g",
    "league_avg_so_per_g",
    "source",
)
KBO_BATTER_FACTOR_FIELDS = (
    "avg_per_g",
    "opp_factor",
    "park_factor",
    "split_factor",
    "pitcher_factor",
    "projected_pa",
    "opp_pitcher",
    "opp_pitcher_whip",
    "opp_pitcher_hand",
    "batter_hand",
    "venue",
    "home_team",
)


def _name_sig(name: str | None) -> str:
    return re.sub(r"[^a-z0-9]", "", normalize_name(name or ""))


def _index_projections(path: Path) -> tuple[dict[tuple[str, str], list[dict]], str | None]:
    """(name signature, prop) -> projection rows, indexed by name and pp_name."""
    data = load_json(path, default={}) or {}
    index: dict[tuple[str, str], list[dict]] = defaultdict(list)
    for row in data.get("projections") or []:
        prop = str(row.get("prop") or "")
        sigs = {_name_sig(row.get("name")), _name_sig(row.get("pp_name"))} - {""}
        for sig in sigs:
            index[(sig, prop)].append(row)
    return index, data.get("generated_at")


def _pick_projection(rows: list[dict], odds_type: str, line) -> dict:
    """Prefer the row for the same odds_type+line, then same odds_type, then any."""
    if not rows:
        return {}
    for row in rows:
        if (row.get("odds_type") or "standard") == odds_type and row.get("line") == line:
            return row
    for row in rows:
        if (row.get("odds_type") or "standard") == odds_type:
            return row
    return rows[0]


def _kbo_lookup(index, names, props: tuple[str, ...], odds_type, line) -> dict:
    for name in names:
        sig = _name_sig(name)
        if not sig:
            continue
        for prop in props:
            row = _pick_projection(index.get((sig, prop), []), odds_type, line)
            if row:
                return row
    return {}


def build_kbo_props(
    data: dict,
    slate_date: date,
    *,
    pitcher_index: dict | None = None,
    batter_index: dict | None = None,
    projections_generated_at: dict | None = None,
    now: datetime | None = None,
    ignore_cutoff: bool = False,
) -> tuple[list[dict], dict]:
    """Board cards -> schema-2 slate props for one KST date, applying the cutoff."""
    now = _now(now)
    commit = source_commit()
    pitcher_index = pitcher_index or {}
    batter_index = batter_index or {}
    generated = projections_generated_at or {}
    start, start_source = cutoff.kbo_first_pitch(slate_date)
    stats = {"skipped_started": 0, "skipped_game_log_present": 0, "missing_projection": 0}
    if not ignore_cutoff and cutoff.has_started(start, now):
        stats["skipped_started"] = sum(len(c.get("props") or []) for c in data.get("cards") or [])
        return [], stats

    out: list[dict] = []
    for card in data.get("cards") or []:
        role = card.get("type")
        card_props = card.get("props") or []
        game_dates = [g.get("date") for g in card.get("games") or []]
        if not ignore_cutoff and cutoff.played_on(game_dates, slate_date, parse_date):
            stats["skipped_game_log_present"] += len(card_props)
            continue
        names = (card.get("name"), card.get("pp_name"), card.get("display_name"))
        for prop in card_props:
            stat = prop.get("stat")
            line = prop.get("line")
            odds_type = prop.get("odds_type") or "standard"
            factors: dict = {}
            if role == "pitcher":
                src = _kbo_lookup(
                    pitcher_index, names, (KBO_PITCHER_STAT_TO_PROP.get(stat, stat),), odds_type, line
                )
                # Never fall back to cg_projection (a 1-100 score) or card `avg`
                # (a historical mean when no projection matched).
                projection = src.get("projection")
                projection_source = "strikeout_projections.json" if projection is not None else None
                factors = {k: src.get(k) for k in KBO_PITCHER_FACTOR_FIELDS if src.get(k) is not None}
                games_used = src.get("games_used")
                gen_at = generated.get("pitcher")
            else:
                src = _kbo_lookup(
                    batter_index, names, KBO_BATTER_STAT_ALIASES.get(stat, (stat,)), odds_type, line
                )
                projection = prop.get("projection")
                projection_source = "prizepicks_props.json" if projection is not None else None
                if projection is None and src.get("projection") is not None:
                    projection = src.get("projection")
                    projection_source = "batter_projections.json"
                factors = {k: src.get(k) for k in KBO_BATTER_FACTOR_FIELDS if src.get(k) is not None}
                games_used = src.get("games_used")
                gen_at = generated.get("batter")
            if projection is None:
                stats["missing_projection"] += 1
            cg = prop.get("cg_projection")
            if cg is None:
                cg = src.get("cg_projection")
            row = {
                "player": card.get("name"),
                "team": card.get("team"),
                "opponent": card.get("opponent"),
                "role": role,
                "venue": card.get("venue"),
                "stat": stat,
                "line": line,
                "odds_type": odds_type,
                "recommendation": prop.get("recommendation"),
                "projection": projection,
                "projection_source": projection_source,
                "edge": _edge(projection, line),
                "cg_projection": cg,
                "rating": prop.get("rating") if prop.get("rating") is not None else src.get("rating"),
                "games_used": games_used,
                "factors": factors or None,
                "projections_generated_at": gen_at,
                "hit_rate_all": prop.get("hit_rate_all"),
                "hit_rate_l5": prop.get("hit_rate_l5"),
                "hit_rate_l10": prop.get("hit_rate_l10"),
                "hit_rate_l20": prop.get("hit_rate_l20"),
            }
            if ignore_cutoff:
                row["cutoff_ignored"] = True
            out.append(_stamp(row, start, start_source, now, commit))
    return out, stats


def freeze_kbo(
    slate_date: date | None = None,
    dry_run: bool = False,
    *,
    now: datetime | None = None,
    ignore_cutoff: bool = False,
) -> dict:
    props_path = PUBLIC_DATA / "prizepicks_props.json"
    data = load_json(props_path)
    if not data:
        raise SystemExit(f"Missing KBO props board: {props_path}")

    resolved = slate_date or kst_game_date_from_meta() or today_kst()
    pitcher_index, pitcher_gen = _index_projections(PUBLIC_DATA / "strikeout_projections.json")
    batter_index, batter_gen = _index_projections(PUBLIC_DATA / "batter_projections.json")
    incoming, stats = build_kbo_props(
        data,
        resolved,
        pitcher_index=pitcher_index,
        batter_index=batter_index,
        projections_generated_at={"pitcher": pitcher_gen, "batter": batter_gen},
        now=now,
        ignore_cutoff=ignore_cutoff,
    )
    out = {"sport": "kbo", "slate_date": format_mmddyyyy(resolved), "props": len(incoming), **stats}
    if dry_run:
        out["dry_run"] = True
        return out
    if not incoming:
        out["note"] = "no pregame props to freeze (cutoff reached or empty board)"
        return out
    out["path"] = str(write_slate("kbo", resolved, incoming, source=str(props_path.relative_to(REPO_ROOT))))
    return out


# ── WNBA ────────────────────────────────────────────────────────────────────


def freeze_wnba(
    slate_date: date | None = None,
    dry_run: bool = False,
    *,
    today: date | None = None,
    now: datetime | None = None,
    ignore_cutoff: bool = False,
) -> dict:
    """Freeze WNBA boards into memory keyed by each prop's ET gameDate.

    Past gameDates (before today ET) are skipped unless explicitly forced via
    ``slate_date``: the live boards keep yesterday's props around with
    projections/ratings recomputed from boxscores that already include those
    games, so merging them would overwrite pregame picks with post-game ones
    (look-ahead leakage into the graded hit rate). Same-day props are skipped
    once tip-off has passed (cutoff.py) or the player's log already has the game.
    """
    now = _now(now)
    today = today or today_et()
    commit = source_commit()
    team_times = cutoff.wnba_team_tip_times(load_json(PUBLIC_DATA / "wnba" / "lineups.json", default=[]))
    skipped_past: dict[date, int] = defaultdict(int)
    skipped_started: dict[date, int] = defaultdict(int)
    boards = {
        "standard": PUBLIC_DATA / "wnba" / "projections_standard.json",
        "demon": PUBLIC_DATA / "wnba" / "projections_demon.json",
        "goblin": PUBLIC_DATA / "wnba" / "projections_goblin.json",
    }
    by_date: dict[date, list[dict]] = defaultdict(list)
    for odds_type, path in boards.items():
        rows = load_json(path, default=[]) or []
        for row in rows:
            log_dates = [g.get("date") for g in row.get("recentGames") or []]
            for prop in row.get("ppAllProps") or []:
                gamedate = parse_date(prop.get("gameDate"))
                if not gamedate:
                    continue
                if slate_date and gamedate != slate_date:
                    continue
                if not slate_date and gamedate < today:
                    skipped_past[gamedate] += 1
                    continue
                start, start_source = cutoff.wnba_tipoff(gamedate, row.get("team"), team_times, today)
                if not ignore_cutoff and (
                    cutoff.has_started(start, now) or cutoff.played_on(log_dates, gamedate, parse_date)
                ):
                    skipped_started[gamedate] += 1
                    continue
                entry = {
                    "player": row.get("name"),
                    "team": row.get("team"),
                    "position": row.get("position"),
                    "opponent": prop.get("opponent") or prop.get("versus"),
                    "stat": prop.get("stat"),
                    "line": prop.get("line"),
                    "odds_type": odds_type,
                    "recommendation": prop.get("sharpSide")
                    or ("OVER" if (prop.get("rating") or 50) >= 50 else "UNDER"),
                    "projection": prop.get("projection"),
                    "projection_source": "wnba/backend/index.js" if prop.get("projection") is not None else None,
                    "edge": _edge(prop.get("projection"), prop.get("line")),
                    "rating": prop.get("rating"),
                    "standard_line": prop.get("standardLine"),
                    "game_date_iso": format_iso(gamedate),
                    "effective_dvp_factor": prop.get("effectiveDvpFactor"),
                    "sharp_side": prop.get("sharpSide"),
                    "sharp_score": prop.get("sharpScore"),
                    "sharp_odds": prop.get("sharpOdds"),
                    "avg_mins": row.get("avgMins"),
                    "dvp_opponent": row.get("dvpOpponent"),
                    "spread": row.get("spread"),
                }
                if ignore_cutoff:
                    entry["cutoff_ignored"] = True
                by_date[gamedate].append(_stamp(entry, start, start_source, now, commit))

    skipped = {format_mmddyyyy(d): n for d, n in sorted(skipped_past.items())}
    started = {format_mmddyyyy(d): n for d, n in sorted(skipped_started.items())}
    if not by_date:
        out = {"sport": "wnba", "dates": 0, "props": 0, "note": "no pregame ppAllProps with gameDate"}
        if skipped:
            out["skipped_past_dates"] = skipped
        if started:
            out["skipped_started"] = started
        return out

    summaries = []
    for d, props in sorted(by_date.items()):
        if dry_run:
            summaries.append({"slate_date": format_mmddyyyy(d), "props": len(props), "dry_run": True})
            continue
        path = write_slate(
            "wnba",
            d,
            props,
            source="kbo-props-ui/public/data/wnba/projections_*.json",
        )
        summaries.append({"slate_date": format_mmddyyyy(d), "props": len(props), "path": str(path)})
    out = {"sport": "wnba", "dates": len(summaries), "results": summaries}
    if skipped:
        out["skipped_past_dates"] = skipped
    if started:
        out["skipped_started"] = started
    return out


# ── NFL ─────────────────────────────────────────────────────────────────────


def _nfl_team_schedule(lineups: list) -> dict[str, tuple[date, str | None]]:
    mapping: dict[str, tuple[date, str | None]] = {}
    for matchup in lineups or []:
        gameday = parse_date(matchup.get("gameday"))
        if not gameday:
            continue
        for team_key in ("awayTeam", "homeTeam"):
            team = matchup.get(team_key)
            if team:
                mapping[str(team).upper()] = (gameday, matchup.get("gametime"))
    return mapping


def _nfl_team_gameday(lineups: list) -> dict[str, date]:
    """Backward-compatible helper: team -> gameday."""
    return {team: day for team, (day, _) in _nfl_team_schedule(lineups).items()}


# D8: compact NFL projection/line history. One JSONL file per gameday under
# memory/nfl/<mm>/<dd>/<yyyy>/history.jsonl, appended ONLY when a prop's line or
# projection changed since its last recorded row (plus the first sighting), and
# only while the game is pregame. memory/** is excluded from deploy.yml's push
# paths and is not part of the Vercel bundle (kbo-props-ui/), and the publish
# commit is made with GITHUB_TOKEN (which never triggers other workflows), so
# this cannot cause a redeploy loop. Append-only text also delta-compresses well.
NFL_HISTORY_FILE = "history.jsonl"
NFL_HISTORY_FIELDS = (
    ("seasonAverage", "season_average"),
    ("gamesPlayed", "games_played"),
    ("recent", "recent"),
    ("snapCount", "snap_count"),
    ("dvpRank", "dvp_rank"),
    ("dvpRatio", "dvp_ratio"),
    ("hitRate", "hit_rate_l10"),
    ("seasonHitRate", "season_hit_rate"),
    ("seasonGames", "season_games"),
    ("hitRateL5", "hit_rate_l5"),
    ("hitRateL20", "hit_rate_l20"),
)


def _nfl_history_key(row: dict) -> tuple[str, str]:
    player, stat, _ = prop_key(row)
    return player, stat


def append_nfl_history(d: date, rows: list[dict]) -> tuple[Path, int]:
    """Append changed rows to the gameday history file. Returns (path, rows_written)."""
    path = ensure_memory_dir("nfl", d) / NFL_HISTORY_FILE
    last: dict[tuple[str, str], tuple] = {}
    if path.exists():
        with path.open(encoding="utf-8") as handle:
            for line in handle:
                line = line.strip()
                if not line:
                    continue
                try:
                    rec = json.loads(line)
                except ValueError:
                    continue
                last[_nfl_history_key(rec)] = (rec.get("line"), rec.get("projection"))
    fresh = []
    for row in rows:
        key = _nfl_history_key(row)
        sig = (row.get("line"), row.get("projection"))
        if not key[0] or last.get(key) == sig:
            continue
        last[key] = sig
        fresh.append(row)
    if fresh:
        with path.open("a", encoding="utf-8") as handle:
            for row in fresh:
                handle.write(json.dumps(row, ensure_ascii=False, separators=(",", ":")) + "\n")
    return path, len(fresh)


def freeze_nfl(
    slate_date: date | None = None,
    dry_run: bool = False,
    *,
    now: datetime | None = None,
    ignore_cutoff: bool = False,
    write_history: bool = True,
) -> dict:
    now = _now(now)
    commit = source_commit()
    projections_path = REPO_ROOT / "nfl" / "projections.json"
    lineups_path = REPO_ROOT / "nfl" / "lineups.json"
    projections = load_json(projections_path, default=[]) or []
    lineups = load_json(lineups_path, default=[]) or []
    if not projections:
        raise SystemExit(
            f"Missing NFL projections at {projections_path}. "
            "Run `python nfl/build_projection_data.py` first (file is gitignored)."
        )

    schedule = _nfl_team_schedule(lineups)
    by_date: dict[date, list[dict]] = defaultdict(list)
    history: dict[date, list[dict]] = defaultdict(list)
    fallback = slate_date or today_et()
    skipped_started: dict[date, int] = defaultdict(int)
    now_iso = cutoff.to_utc_iso(now)

    for row in projections:
        team = str(row.get("team") or "").upper()
        gameday, gametime = schedule.get(team) or (fallback, None)
        if slate_date and gameday != slate_date:
            continue
        start, start_source = cutoff.nfl_kickoff(gameday, gametime)
        if not ignore_cutoff and cutoff.has_started(start, now):
            skipped_started[gameday] += 1
            continue
        projection = row.get("projection")
        line = row.get("line")
        games_played = row.get("gamesPlayed")
        # build_projection_data.py returns the line itself when < 3 games.
        line_fallback = isinstance(games_played, int) and games_played < 3
        entry = {
            "player": row.get("player"),
            "team": row.get("team"),
            "opponent": row.get("opponent"),
            "position": row.get("position"),
            "stat": row.get("prop"),
            "line": line,
            "odds_type": "standard",
            "recommendation": "OVER" if (projection or 0) >= (line or 0) else "UNDER",
            "projection": projection,
            "projection_source": "nfl/build_projection_data.py" if projection is not None else None,
            "projection_is_line_fallback": line_fallback,
            "edge": _edge(projection, line),
            "rating": row.get("seasonHitRate"),
            "game_date_iso": format_iso(gameday),
            "season_average": row.get("seasonAverage"),
            "games_played": games_played,
            "snap_count": row.get("snapCount"),
            "dvp_rank": row.get("dvpRank"),
            "dvp_ratio": row.get("dvpRatio"),
        }
        if ignore_cutoff:
            entry["cutoff_ignored"] = True
        by_date[gameday].append(_stamp(entry, start, start_source, now, commit))
        hist = {
            "ts": now_iso,
            "player": row.get("player"),
            "team": row.get("team"),
            "opponent": row.get("opponent"),
            "position": row.get("position"),
            "stat": row.get("prop"),
            "line": line,
            "projection": projection,
            "kickoff_utc": cutoff.to_utc_iso(start),
            "kickoff_source": start_source,
            "source_commit": commit,
        }
        for src_key, dst_key in NFL_HISTORY_FIELDS:
            if row.get(src_key) is not None:
                hist[dst_key] = row.get(src_key)
        history[gameday].append(hist)

    summaries = []
    for d, props in sorted(by_date.items()):
        if dry_run:
            summaries.append({"slate_date": format_mmddyyyy(d), "props": len(props), "dry_run": True})
            continue
        path = write_slate("nfl", d, props, source="nfl/projections.json")
        item = {"slate_date": format_mmddyyyy(d), "props": len(props), "path": str(path)}
        if write_history and not slate_is_locked("nfl", d):
            hist_path, n = append_nfl_history(d, history[d])
            item["history_rows_appended"] = n
            item["history_path"] = str(hist_path)
        summaries.append(item)
    out = {"sport": "nfl", "dates": len(summaries), "results": summaries}
    if skipped_started:
        out["skipped_started"] = {format_mmddyyyy(d): n for d, n in sorted(skipped_started.items())}
    return out


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Freeze/merge live prop boards into memory/")
    parser.add_argument("--sport", choices=("kbo", "wnba", "nfl", "all"), required=True)
    parser.add_argument("--date", help="Optional slate date mm/dd/YYYY or YYYY-MM-DD")
    parser.add_argument("--dry-run", action="store_true", help="Parse boards without writing")
    parser.add_argument(
        "--ignore-cutoff",
        action="store_true",
        help="Manual backfill only: freeze even after the start time (props get cutoff_ignored=true)",
    )
    parser.add_argument("--no-nfl-history", action="store_true", help="Skip memory/nfl/.../history.jsonl")
    args = parser.parse_args(argv)

    targets = ["kbo", "wnba", "nfl"] if args.sport == "all" else [args.sport]
    out = []
    fatal = None
    for sport in targets:
        try:
            if sport == "kbo":
                forced = parse_cli_date(args.date, today_kst()) if args.date else None
                out.append(freeze_kbo(forced, dry_run=args.dry_run, ignore_cutoff=args.ignore_cutoff))
            elif sport == "wnba":
                forced = parse_cli_date(args.date, today_et()) if args.date else None
                out.append(freeze_wnba(forced, dry_run=args.dry_run, ignore_cutoff=args.ignore_cutoff))
            else:
                forced = parse_cli_date(args.date, today_et()) if args.date else None
                out.append(
                    freeze_nfl(
                        forced,
                        dry_run=args.dry_run,
                        ignore_cutoff=args.ignore_cutoff,
                        write_history=not args.no_nfl_history,
                    )
                )
        except SystemExit as exc:
            out.append({"sport": sport, "error": str(exc)})
            if args.sport != "all":
                fatal = exc

    print(json.dumps(out if len(out) > 1 else out[0], indent=2))
    if fatal is not None:
        raise SystemExit(str(fatal))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

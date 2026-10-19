#!/usr/bin/env python3
"""Grade NFL memory slates against nflverse weekly stats by gameday.

A scheduled run grades every slate from the last 14 days that is still
awaiting a complete recap, so Monday and Thursday cards are not skipped
just because the latest Sunday was the only default.
"""
from __future__ import annotations

import argparse
import json
import re
import sys
from datetime import date, timedelta
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[2]))

from pipeline.memory.common import (
    RESULT_DNP,
    RESULT_VOID,
    compute_hit_rate_stats,
    format_iso,
    format_mmddyyyy,
    grade_line,
    load_json,
    locked_day_result,
    matchup_pair,
    recap_locked,
    memory_dir,
    model_result,
    normalize_name,
    parse_cli_date,
    parse_date,
    postponed_matchups,
    today_et,
    utc_now_iso,
    write_meta,
    write_partial_progress,
    write_recap,
)
from pipeline.memory.common import MODEL_NA, RESULT_VOID, nfl_left_board_pregame

# Today plus the 14 days before it. A slate dated exactly 14 days ago is included.
LOOKBACK_DAYS = 14

STATS_URL = "https://github.com/nflverse/nflverse-data/releases/download/stats_player/stats_player_week_{season}.csv"
# nflverse dropped uncompressed games.csv on 2026-10-06. pandas reads this gzip URL.
GAMES_URL = "https://github.com/nflverse/nflverse-data/releases/download/schedules/games.csv.gz"
HISTORY_SEASONS = (2025, 2026)

STAT_COLUMNS = {
    "Pass Yards": "passing_yards",
    "Pass Attempts": "attempts",
    "Pass Completions": "completions",
    "Pass TDs": "passing_tds",
    "Rush Yards": "rushing_yards",
    "Rush Attempts": "carries",
    "Receiving Yards": "receiving_yards",
    "Receptions": "receptions",
    "Rec Targets": "targets",
}


def _counts(graded: list[dict], ungraded: list) -> dict:
    stats = compute_hit_rate_stats(graded)
    return {
        "hits": stats["hits"],
        "misses": stats["misses"],
        "pushes": stats["pushes"],
        "dnps": stats["dnps"],
        "voids": stats["voids"],
        "missing": stats["missing"],
        "ungraded": len(ungraded),
    }


def awaiting_slate_dates(today: date | None = None, days: int = LOOKBACK_DAYS) -> list[date]:
    """Slate dates in the last `days` days that are not graded complete.

    The window is inclusive of `today` and of the date `days` days earlier.
    A day is awaiting when it has a slate and does not yet have a complete
    recap. Monday and Thursday slates stay in this window; a finished Sunday
    does not.
    """
    today = today or today_et()
    found: list[date] = []
    for offset in range(max(0, days) + 1):
        d = today - timedelta(days=offset)
        day_dir = memory_dir("nfl", d)
        if not (day_dir / "slate.json").exists():
            continue
        meta = load_json(day_dir / "meta.json", default={}) or {}
        if meta.get("status") == "complete" and (day_dir / "recap.json").exists():
            continue
        found.append(d)
    return sorted(found)


def name_key(name: str) -> str:
    stripped = re.sub(r"\s+(jr|sr|ii|iii|iv|v)\.?$", "", str(name).lower().strip())
    return re.sub(r"[^a-z0-9]", "", stripped)


TEAM_ALIASES = {"JAC": "JAX", "LAR": "LA", "WSH": "WAS", "OAK": "LV", "SD": "LAC", "STL": "LA"}


def nfl_team(code) -> str:
    text = str(code or "").strip().upper()
    return TEAM_ALIASES.get(text, text)


ROSTER_URL = "https://github.com/nflverse/nflverse-data/releases/download/weekly_rosters/roster_weekly_{season}.csv"
SNAPS_URL = "https://github.com/nflverse/nflverse-data/releases/download/snap_counts/snap_counts_{season}.csv"

# Roster status other than active on game week means the player could not play.
INACTIVE_STATUSES = {"INA", "RES", "CUT", "DEV", "RET", "EXE", "TRD", "TRT", "SUS", "PUP", "NON"}

# First-name variants nflverse uses differently from PrizePicks.
NICKNAMES = [
    {"josh", "joshua"}, {"gabe", "gabriel"}, {"hollywood", "marquise"}, {"mike", "michael"},
    {"chris", "christopher"}, {"matt", "matthew"}, {"nick", "nicholas"}, {"tony", "anthony"},
    {"ben", "benjamin"}, {"dan", "daniel", "danny"}, {"will", "william", "bill"}, {"rob", "robert", "bob", "bobby"},
    {"jim", "james", "jimmy"}, {"joe", "joseph", "joey"}, {"tom", "thomas", "tommy"}, {"sam", "samuel"},
    {"alex", "alexander"}, {"cam", "cameron"}, {"zach", "zachary", "zack"}, {"jake", "jacob"},
    {"ken", "kenneth", "kenny"}, {"pat", "patrick"}, {"greg", "gregory"}, {"jeff", "jeffery", "jeffrey"},
    {"dave", "david"}, {"steve", "steven", "stephen"}, {"tim", "timothy"}, {"andy", "andrew", "drew"},
    {"trey", "tre"}, {"aj", "arthur"}, {"dj", "david"}, {"tj", "thomas"}, {"chig", "chigoziem"},
]
_SUFFIX = re.compile(r"\s+(jr|sr|ii|iii|iv|v)\.?$")


def _name_tokens(name) -> list[str]:
    text = normalize_name(name)
    text = _SUFFIX.sub("", text.replace(".", "").strip())
    return [re.sub(r"[^a-z0-9]", "", tok) for tok in text.replace("-", " ").split() if re.sub(r"[^a-z0-9]", "", tok)]


def first_names_compatible(a: str, b: str) -> bool:
    if not a or not b:
        return False
    if a == b:
        return True
    short, long_ = sorted((a, b), key=len)
    if len(short) >= 3 and long_.startswith(short):
        return True
    return any(a in group and b in group for group in NICKNAMES)


def _clean(value):
    if value is None:
        return None
    try:
        if value != value:  # NaN
            return None
    except Exception:  # noqa: BLE001
        pass
    text = str(value).strip()
    return text or None


class NflDay:
    """Everything needed to grade one gameday, keyed by player id, not name."""

    def __init__(self, target: date):
        self.target = target
        self.team_games: dict[str, dict] = {}  # team -> {"week", "season", "final", "opponent"}
        self.stats_by_id: dict[str, dict] = {}
        self.roster: dict[str, list[dict]] = {}  # team -> rows for that week
        self.snaps_by_pfr: dict[str, float] = {}
        self.teams_with_snaps: set[str] = set()
        self.teams_with_stats: set[str] = set()

    def game_for(self, team: str) -> dict | None:
        return self.team_games.get(nfl_team(team))

    def resolve(self, player: str, team: str) -> dict | None:
        """Unique roster row for this slate name on this team, or None (never guessed)."""
        tokens = _name_tokens(player)
        if not tokens:
            return None
        full = "".join(tokens)
        first, last = tokens[0], tokens[-1]
        rows = self.roster.get(nfl_team(team)) or []
        exact = [r for r in rows if "".join(_name_tokens(r.get("full_name"))) == full]
        if len(exact) == 1:
            return exact[0]
        candidates = []
        for row in rows:
            row_last = (_name_tokens(row.get("last_name")) or [""])[-1]
            if row_last != last:
                continue
            firsts = {"".join(_name_tokens(row.get(k))) for k in ("first_name", "football_name")} - {""}
            if any(first_names_compatible(first, f) for f in firsts):
                candidates.append(row)
        return candidates[0] if len(candidates) == 1 else None


def _read(url: str, pd):
    try:
        return pd.read_csv(url, low_memory=False)
    except Exception as exc:  # network / missing release
        print(f"warn: could not load {url.rsplit('/', 1)[-1]}: {exc}", file=sys.stderr)
        return None


def load_day(target: date, slate_teams: set[str]) -> NflDay:
    """Schedule, stats, weekly roster and snap counts for the slate's own games."""
    try:
        import pandas as pd
    except ImportError as exc:
        raise SystemExit("pandas is required for NFL grading") from exc

    day = NflDay(target)
    slate_teams = {nfl_team(t) for t in slate_teams if t}
    games = pd.read_csv(GAMES_URL, low_memory=False)
    games["gameday_parsed"] = pd.to_datetime(games["gameday"], errors="coerce").dt.date
    day_games = games[games["gameday_parsed"] == target]
    for row in day_games.to_dict("records"):
        home, away = nfl_team(row.get("home_team")), nfl_team(row.get("away_team"))
        if home not in slate_teams and away not in slate_teams:
            continue  # finality is based only on the slate's own games
        final = _clean(row.get("home_score")) is not None and _clean(row.get("away_score")) is not None
        for team, opp in ((home, away), (away, home)):
            day.team_games[team] = {"season": int(row["season"]), "week": int(row["week"]),
                                    "final": final, "opponent": opp}
    if not day.team_games:
        return day

    seasons = sorted({g["season"] for g in day.team_games.values()})
    weeks = {(g["season"], g["week"], team) for team, g in day.team_games.items()}
    for season in seasons:
        stats = _read(STATS_URL.format(season=season), pd)
        if stats is not None and not stats.empty:
            stats = stats[stats["season_type"].isin(["REG", "POST"])] if "season_type" in stats else stats
            for row in stats.to_dict("records"):
                key = (int(row.get("season") or season), int(row.get("week") or 0), nfl_team(row.get("team")))
                pid = _clean(row.get("player_id"))
                if key not in weeks or not pid:
                    continue
                entry = {
                    "present": True,
                    "player": row.get("player_display_name") or "",
                    "player_id": pid,
                    "team": key[2],
                }
                for col in ("passing_yards", "attempts", "completions", "passing_tds", "rushing_yards",
                            "carries", "receiving_yards", "receptions", "targets"):
                    entry[col] = row.get(col)
                attach_combo_yards(entry)
                day.stats_by_id[pid] = entry
                day.teams_with_stats.add(key[2])
        roster = _read(ROSTER_URL.format(season=season), pd)
        if roster is not None and not roster.empty:
            for row in roster.to_dict("records"):
                key = (int(row.get("season") or season), int(row.get("week") or 0), nfl_team(row.get("team")))
                if key in weeks:
                    day.roster.setdefault(key[2], []).append(row)
        snaps = _read(SNAPS_URL.format(season=season), pd)
        if snaps is not None and not snaps.empty:
            for row in snaps.to_dict("records"):
                key = (int(row.get("season") or season), int(row.get("week") or 0), nfl_team(row.get("team")))
                if key not in weeks:
                    continue
                day.teams_with_snaps.add(key[2])
                pfr = _clean(row.get("pfr_player_id"))
                if pfr:
                    total = sum(float(_clean(row.get(c)) or 0) for c in ("offense_snaps", "defense_snaps", "st_snaps"))
                    day.snaps_by_pfr[pfr] = day.snaps_by_pfr.get(pfr, 0.0) + total
    return day


def load_actuals_for_date(target: date, slate_teams: set[str] | None = None) -> NflDay:
    """Kept for callers/tests; see load_day."""
    return load_day(target, slate_teams or set())


ZERO_STATS = {col: 0 for col in ("passing_yards", "attempts", "completions", "passing_tds", "rushing_yards",
                                 "carries", "receiving_yards", "receptions", "targets")}


def _is_nan(value) -> bool:
    try:
        number = float(value)
    except (TypeError, ValueError):
        return False
    return number != number


def _combo_component(value) -> float | None:
    """Blank nflverse cells are zero. NaN is missing and must not add into a combo."""
    if value is None or value == "":
        return 0.0
    number = float(value)
    if number != number:
        return None
    return number


def attach_combo_yards(entry: dict) -> dict:
    passing = _combo_component(entry.get("passing_yards"))
    rushing = _combo_component(entry.get("rushing_yards"))
    receiving = _combo_component(entry.get("receiving_yards"))
    entry["pass_rush"] = None if passing is None or rushing is None else passing + rushing
    entry["rush_rec"] = None if rushing is None or receiving is None else rushing + receiving
    return entry


def stat_is_nan(stats: dict, stat: str) -> bool:
    """True when this stat, or a combo that includes it, is NaN rather than zero."""
    if stat == "Pass+Rush Yds":
        return stats.get("pass_rush") is None and (
            _is_nan(stats.get("passing_yards")) or _is_nan(stats.get("rushing_yards"))
        )
    if stat == "Rush+Rec Yds":
        return stats.get("rush_rec") is None and (
            _is_nan(stats.get("rushing_yards")) or _is_nan(stats.get("receiving_yards"))
        )
    column = STAT_COLUMNS.get(stat)
    return bool(column) and _is_nan(stats.get(column))


def actual_for_stat(stats: dict, stat: str):
    if stat == "Pass+Rush Yds":
        return stats.get("pass_rush")
    if stat == "Rush+Rec Yds":
        return stats.get("rush_rec")
    col = STAT_COLUMNS.get(stat)
    if not col:
        return None
    val = stats.get(col)
    if val is None:
        return 0.0  # nflverse often omits zeros
    try:
        number = float(val)
    except (TypeError, ValueError):
        return None
    if number != number:
        return None  # NaN is missing, not a push
    return number


def grade_day(d: date, *, dry_run: bool = False, regrade: bool = False) -> dict:
    day_dir = memory_dir("nfl", d)
    # Recapped days are locked, for scheduled and manual --date runs alike.
    # --regrade re-reads finals, but only a complete result can replace the recap.
    if recap_locked("nfl", d) and not regrade:
        return locked_day_result("nfl", d, dry_run=dry_run)
    slate = load_json(day_dir / "slate.json")
    if not slate or not slate.get("props"):
        if not dry_run:
            write_meta(
                "nfl",
                d,
                status="waiting",
                props_total=0,
                props_graded=0,
                missing=["no slate.json — freeze the board first"],
            )
        return {"status": "waiting", "reason": "no slate", "slate_date": format_mmddyyyy(d)}

    props = slate["props"]
    slate_teams = {nfl_team(p.get("team")) for p in props} | {nfl_team(p.get("opponent")) for p in props}
    slate_teams.discard("")
    try:
        day = load_actuals_for_date(d, slate_teams)
    except SystemExit as exc:
        if not dry_run:
            write_meta(
                "nfl",
                d,
                status="waiting",
                props_total=len(props),
                props_graded=0,
                missing=[str(exc)],
            )
        return {"status": "waiting", "reason": str(exc), "slate_date": format_mmddyyyy(d)}

    graded = []
    missing = []
    postponed = postponed_matchups("nfl", d)
    finalized = bool(day.team_games) and all(g["final"] for g in day.team_games.values())

    def _void(prop: dict, reason: str) -> dict:
        return {**prop, "actual": None, "result": RESULT_VOID,
                "model_result": model_result(RESULT_VOID, prop.get("recommendation")),
                "void_reason": reason, "graded_at": utc_now_iso()}

    def _miss(prop: dict, reason: str) -> None:
        missing.append({"player": prop.get("player") or "", "stat": prop.get("stat") or "",
                        "odds_type": prop.get("odds_type"), "reason": reason})

    for prop in props:
        player = prop.get("player") or ""
        stat = prop.get("stat") or ""
        line = prop.get("line")
        # Same rule as #238 (runs first, before any matching/DNP logic): a
        # standard line that left the board (pulled by PrizePicks, OUT/inactive,
        # or gone from the board read) before kickoff is Void.
        if nfl_left_board_pregame(prop):
            graded.append(
                {
                    **prop,
                    "actual": None,
                    "result": RESULT_VOID,
                    "model_result": MODEL_NA,
                    "void_reason": "left board before last pregame freeze",
                    "graded_at": utc_now_iso(),
                }
            )
            continue
        team = nfl_team(prop.get("team"))
        pair = matchup_pair(team, nfl_team(prop.get("opponent")))
        game = day.game_for(team)
        if pair and pair in postponed:
            # Listed in memory/postponements.json: Void.
            graded.append(_void(prop, "postponed"))
            continue
        if game is None:
            # No game for this team on this gameday in the schedule. That is
            # unknown (moved, bad team code, schedule lag), never a Void.
            _miss(prop, "no_game_found" if day.team_games else "no_schedule")
            continue
        row = day.resolve(player, team)
        if row is None:
            _miss(prop, "player_unmatched")  # never Void/DNP on a name mismatch
            continue
        gsis = _clean(row.get("gsis_id"))
        stats = day.stats_by_id.get(gsis) if gsis else None
        if not stats:
            if not game["final"]:
                _miss(prop, "game_not_final")
                continue
            status = str(_clean(row.get("status")) or "").upper()
            pfr = _clean(row.get("pfr_id"))
            if status in INACTIVE_STATUSES:
                dnp = True
            elif team not in day.teams_with_snaps:
                _miss(prop, "no_snap_counts")
                continue
            elif not pfr:
                _miss(prop, "no_pfr_id")
                continue
            else:
                dnp = day.snaps_by_pfr.get(pfr, 0.0) <= 0
            if dnp:
                graded.append({**prop, "actual": None, "result": RESULT_DNP,
                               "model_result": model_result(RESULT_DNP, prop.get("recommendation")),
                               "dnp_reason": "inactive" if status in INACTIVE_STATUSES else "zero_snaps",
                               "graded_at": utc_now_iso()})
                continue
            # Played (snaps > 0) with no nflverse stat row: a real 0.
            stats = attach_combo_yards(dict(ZERO_STATS, present=True, team=team, player_id=gsis))

        actual_val = actual_for_stat(stats, stat)
        if actual_val is None:
            missing.append({
                "player": player,
                "stat": stat,
                "reason": "stat_missing" if stat_is_nan(stats, stat) else "unmapped_stat",
            })
            continue
        try:
            outcome = grade_line(actual_val, line)
        except ValueError:
            missing.append({"player": player, "stat": stat, "reason": "bad_line"})
            continue
        graded.append(
            {
                **prop,
                "actual": actual_val,
                "result": outcome,
                "model_result": model_result(outcome, prop.get("recommendation")),
                "graded_at": utc_now_iso(),
            }
        )

    total = len(props)
    n_graded = len(graded)
    counts = _counts(graded, missing)
    if missing:
        status = "partial" if n_graded else "waiting"
        if not dry_run:
            write_partial_progress(
                "nfl",
                d,
                graded,
                props_total=total,
                missing=missing,
            )
        return {
            "status": status,
            "slate_date": format_mmddyyyy(d),
            "props_total": total,
            "props_graded": n_graded,
            **counts,
            "finalized": finalized,
            "dry_run": dry_run,
        }

    if dry_run:
        return {
            "status": "complete",
            "slate_date": format_mmddyyyy(d),
            "props_total": total,
            "props_graded": n_graded,
            **counts,
            "dry_run": True,
            "sample": graded[:2],
        }

    path = write_recap("nfl", d, graded)
    return {
        "status": "complete",
        "slate_date": format_mmddyyyy(d),
        "props_total": total,
        "props_graded": n_graded,
        **counts,
        "path": str(path),
    }


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Grade NFL memory slates for gamedays still awaiting grades")
    parser.add_argument("--date", help="One gameday, mm/dd/YYYY or YYYY-MM-DD. Default: every awaiting slate in the last 14 days.")
    parser.add_argument("--dry-run", action="store_true")
    parser.add_argument(
        "--regrade",
        action="store_true",
        help="Re-grade a day that already has recap.json. Only a complete result is written; waiting/partial never replaces a graded day.",
    )
    parser.add_argument(
        "--lookback-days",
        type=int,
        default=LOOKBACK_DAYS,
        help=f"With no --date, grade awaiting slates from this many days back (default {LOOKBACK_DAYS}, inclusive).",
    )
    args = parser.parse_args(argv)

    if args.date:
        days = [parse_cli_date(args.date, today_et())]
    else:
        days = awaiting_slate_dates(today_et(), args.lookback_days)
    results = []
    for day in days:
        try:
            results.append(grade_day(day, dry_run=args.dry_run, regrade=args.regrade))
        except Exception as exc:  # noqa: BLE001 - one slate must not block the rest
            results.append({"status": "waiting", "slate_date": format_iso(day), "reason": str(exc)})
    print(json.dumps(results if not args.date else results[0], indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

#!/usr/bin/env python3
"""Grade a KBO memory slate day against pitcher/batter game logs (KST date)."""
from __future__ import annotations

import argparse
import csv
import json
import sys
from datetime import date, timedelta
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[2]))

from pipeline.memory.common import (
    REPO_ROOT,
    RESULT_DNP,
    RESULT_VOID,
    format_iso,
    format_mmddyyyy,
    grade_line,
    load_json,
    locked_day_result,
    recap_locked,
    matchup_pair,
    memory_dir,
    model_result,
    name_match_key,
    parse_cli_date,
    parse_date,
    postponed_matchups,
    pulled_status,
    scheduled_matchups,
    team_key,
    utc_now_iso,
    write_meta,
    write_partial_progress,
    write_recap,
    yesterday_kst,
)

# Map slate stat names → actuals keys (mirrors grade_saved_slips / generate_graded_history)
STAT_KEY = {
    "Pitcher Strikeouts": "so",
    "Strikeouts": "so",
    "K": "so",
    "Hits Allowed": "ha",
    "HA": "ha",
    "Pitching Outs": "outs",
    "OUTS": "outs",
    "Hits+Runs+RBIs": "hrr",
    "HRR": "hrr",
    "Total Bases": "tb",
    "TB": "tb",
    "Fantasy Score": "fs",
    "Hitter Fantasy Score": "fs",
}


# PrizePicks hitter fantasy score weights. Mirrors the formula already used to
# build the site's Fantasy Score projections/cards so grading matches the board:
#   generate_batter_projections.py::build_fantasy_projections (score_weights)
#   generate_props.py::build_batter_card
#   kbo-props-ui/src/BatterProjections.jsx (FS formula footnote)
# NOTE: the site uses SB=2 (PrizePicks' published MLB table lists SB=5); keep
# these in sync with the projection code rather than changing grading alone.
HITTER_FANTASY_WEIGHTS = {
    "single": 3,
    "double": 5,
    "triple": 8,
    "hr": 10,
    "r": 2,
    "rbi": 2,
    "bb": 2,
    "hbp": 2,
    "sb": 2,
}


def _int_field(row: dict, *names: str) -> int:
    """First non-empty integer-ish value among column aliases (missing → 0)."""
    for name in names:
        raw = row.get(name)
        if raw in (None, ""):
            continue
        try:
            return int(float(raw))
        except (TypeError, ValueError):
            continue
    return 0


def hitter_fantasy_components(row: dict) -> dict[str, int]:
    """Extract fantasy components from a KBO_daily_batting_stats_combined.csv row.

    Singles are derived as H - 2B - 3B - HR (floored at 0), matching the
    projection code. Missing component columns count as 0, as in the
    projection code (``int(g.get(col, 0) or 0)``).
    """
    h = _int_field(row, "H")
    doubles = _int_field(row, "2B")
    triples = _int_field(row, "3B")
    hr = _int_field(row, "HR")
    return {
        "single": max(0, h - doubles - triples - hr),
        "double": doubles,
        "triple": triples,
        "hr": hr,
        "r": _int_field(row, "R"),
        "rbi": _int_field(row, "RBI"),
        "bb": _int_field(row, "Walks", "BB"),
        "hbp": _int_field(row, "HBP"),
        "sb": _int_field(row, "SB"),
    }


def hitter_fantasy_score(row: dict) -> float:
    """PrizePicks-style hitter fantasy score computed from box-score components."""
    comps = hitter_fantasy_components(row)
    return float(sum(comps[k] * w for k, w in HITTER_FANTASY_WEIGHTS.items()))


def build_actuals() -> dict[tuple[str, str], dict]:
    """Keyed by (YYYY-MM-DD, normalized_name) -> stats."""
    lookup: dict[tuple[str, str], dict] = {}

    pitcher_path = REPO_ROOT / "Pitchers-Data" / "pitcher_logs.json"
    if pitcher_path.exists():
        for log in load_json(pitcher_path, default=[]) or []:
            if log.get("Role") != "SP":
                continue
            d = parse_date(log.get("Date"))
            name_key = name_match_key(log.get("Name", ""))
            if not d or not name_key:
                continue
            ip = float(log.get("IP") or 0)
            so = log.get("SO", log.get("K", 0)) or 0
            ha = log.get("HA", log.get("H", 0)) or 0
            outs = log.get("PitOuts")
            if outs is None:
                outs = round(ip * 3)
            lookup[(format_iso(d), name_key)] = {
                "type": "pitcher",
                "team": log.get("Tm") or log.get("Team") or "",
                "opponent": log.get("Opp") or log.get("Opponent") or "",
                "so": so,
                "ip": ip,
                "ha": ha,
                "outs": outs,
                "present": True,
            }

    batter_path = REPO_ROOT / "Batters-Data" / "KBO_daily_batting_stats_combined.csv"
    if batter_path.exists():
        with batter_path.open(encoding="utf-8") as handle:
            for row in csv.DictReader(handle):
                d = parse_date(row.get("DATE"))
                name_key = name_match_key(row.get("Name", ""))
                if not d or not name_key:
                    continue
                h = int(row.get("H") or 0)
                r = int(row.get("R") or 0)
                rbi = int(row.get("RBI") or 0)
                tb = int(row.get("TB") or 0)
                hrr = int(row.get("HRR") or (h + r + rbi))
                fs = row.get("FS") or row.get("fs")
                entry = {
                    "type": "batter",
                    "team": row.get("Team") or "",
                    "opponent": row.get("OPP") or row.get("Opp") or "",
                    "h": h,
                    "r": r,
                    "rbi": rbi,
                    "hrr": hrr,
                    "tb": tb,
                    "present": True,
                }
                if fs not in (None, ""):
                    try:
                        entry["fs"] = float(fs)
                    except ValueError:
                        pass
                if "fs" not in entry:
                    # Logs carry components only — derive Hitter Fantasy Score.
                    entry["fs"] = hitter_fantasy_score(row)
                lookup[(format_iso(d), name_key)] = entry

    return lookup


POSTSEASON_FILE = "postseason_actuals.json"


POSTSEASON_MIN_BOX_HITTERS = 9


def postseason_box_dnps(payload: dict) -> set[str]:
    """Name keys confirmed DNP by the official box score.

    All must hold: the player's page identity was verified (Korean name and
    team), his team's game is final, its box score lists at least a full
    lineup, and no hitter or pitcher who appeared matches his verified Korean
    name. A box-score name counts as a match when it is the same text or has
    the same hangul_skeleton (spelling variants, spacing). Anything less stays
    missing.
    """
    from pipeline.memory.kbo_postseason_actuals import hangul_skeleton

    def _same(a: str, b: str) -> bool:
        a, b = str(a or "").strip(), str(b or "").strip()
        if not a or not b:
            return False
        if a == b:
            return True
        sa, sb = hangul_skeleton(a), hangul_skeleton(b)
        return bool(sa) and sa == sb

    out: set[str] = set()
    boxes = {team_key(team): box for team, box in (payload.get("box_scores") or {}).items() if isinstance(box, dict)}
    for player, ident in (payload.get("identities") or {}).items():
        if not player or not isinstance(ident, dict) or not ident.get("name_ko"):
            continue
        name_ko = ident["name_ko"]
        box = boxes.get(team_key(ident.get("team") or ""))
        if not box or not box.get("final") or int(box.get("hitters") or 0) < POSTSEASON_MIN_BOX_HITTERS:
            continue
        if any(_same(name_ko, seen) for seen in box.get("appeared_ko") or []):
            continue
        out.add(name_match_key(player))
    return out


def load_postseason_actuals(d: date) -> tuple[dict[tuple[str, str], dict], set[str], set[str]] | None:
    """Grading-only postseason lines for one KBO day, or None when there is no file.

    The game-log scrapers carry the regular season only, so postseason games
    are fetched per slate player into memory/kbo/.../postseason_actuals.json
    (pipeline/memory/kbo_postseason_actuals.py). Returns three values,
    (lookup, fetched, benched): lookup maps (iso, name key) to the stat line,
    fetched is the name keys whose pages were read and verified, and benched
    is the name keys confirmed DNP by the final box score
    (postseason_box_dnps).
    """
    payload = load_json(memory_dir("kbo", d) / POSTSEASON_FILE)
    if not isinstance(payload, dict):
        return None
    iso = format_iso(d)
    lookup: dict[tuple[str, str], dict] = {}
    for row in payload.get("rows") or []:
        if not isinstance(row, dict) or row.get("date") != iso:
            continue
        key = name_match_key(row.get("player", ""))
        if not key:
            continue
        base = {"team": row.get("team") or "", "opponent": row.get("opponent") or "", "present": True,
                "source": "postseason", "series": row.get("series")}
        if row.get("type") == "pitcher":
            if row.get("role") != "SP":
                continue  # relief outing is not a start, same as the regular-season logs
            lookup[(iso, key)] = {**base, "type": "pitcher", "so": row.get("so", 0), "ha": row.get("ha", 0),
                                  "outs": row.get("outs", 0), "ip": round((row.get("outs") or 0) / 3, 2)}
        else:
            h, r, rbi = int(row.get("h") or 0), int(row.get("r") or 0), int(row.get("rbi") or 0)
            d2, d3, hr = int(row.get("2b") or 0), int(row.get("3b") or 0), int(row.get("hr") or 0)
            fs_row = {"H": h, "2B": d2, "3B": d3, "HR": hr, "R": r, "RBI": rbi,
                      "Walks": row.get("bb", 0), "HBP": row.get("hbp", 0), "SB": row.get("sb", 0)}
            lookup[(iso, key)] = {**base, "type": "batter", "h": h, "r": r, "rbi": rbi, "hrr": h + r + rbi,
                                  "tb": h + d2 + 2 * d3 + 3 * hr, "fs": hitter_fantasy_score(fs_row)}
    fetched = {name_match_key(name) for name in payload.get("fetched_players") or [] if name}
    benched = postseason_box_dnps(payload)
    return lookup, fetched, benched


def _void_prop(prop: dict, reason: str) -> dict:
    """Graded VOID: out of the W-L and the hit rate, but the prop is graded."""
    return {
        **prop,
        "actual": None,
        "result": RESULT_VOID,
        "model_result": model_result(RESULT_VOID, prop.get("recommendation")),
        "void_reason": reason,
        "graded_at": utc_now_iso(),
    }


def grade_day(d: date, *, dry_run: bool = False, allow_partial_write: bool = False, regrade: bool = False) -> dict:
    day_dir = memory_dir("kbo", d)
    # Recapped days are locked, for scheduled and manual --date runs alike.
    # --regrade re-reads finals, but only a complete result can replace the recap.
    if recap_locked("kbo", d) and not regrade:
        return locked_day_result("kbo", d, dry_run=dry_run)
    slate = load_json(day_dir / "slate.json")
    if not slate or not slate.get("props"):
        if not dry_run:
            write_meta(
                "kbo",
                d,
                status="waiting",
                props_total=0,
                props_graded=0,
                missing=["no slate.json — freeze the board first"],
            )
        return {"status": "waiting", "reason": "no slate", "slate_date": format_mmddyyyy(d)}

    actuals = build_actuals()
    iso = format_iso(d)
    postseason = load_postseason_actuals(d)
    postseason_fetched: set[str] | None = None
    postseason_benched: set[str] = set()
    if postseason is not None:
        post_lookup, postseason_fetched, postseason_benched = postseason
        for key, row in post_lookup.items():
            actuals.setdefault(key, row)
    props = slate["props"]
    graded = []
    missing = []

    # A team counts as having played only when a log row's team/opponent pair
    # is one of this slate's games. A mis-tagged row (Koo logged as LOTTE vs
    # Hanwha on a day Lotte was scheduled against Doosan) must not mark Lotte.
    slate_pairs = {
        pair
        for prop in props
        if (pair := matchup_pair(prop.get("team"), prop.get("opponent")))
    }
    teams_done = set()
    for (day, _), row in actuals.items():
        if day != iso or not row.get("team"):
            continue
        pair = matchup_pair(row.get("team"), row.get("opponent"))
        if pair and pair in slate_pairs:
            teams_done.add(team_key(row.get("team")))

    postponed = postponed_matchups("kbo", d)
    scheduled = scheduled_matchups("kbo", d)

    for prop in props:
        player = prop.get("player") or ""
        stat = prop.get("stat") or ""
        stat_key = STAT_KEY.get(stat)
        line = prop.get("line")
        pair = matchup_pair(prop.get("team"), prop.get("opponent"))
        # A line PrizePicks pulled before first pitch is Void, never a W/L.
        if pulled_status(prop):
            graded.append(_void_prop(prop, "pulled"))
            continue
        if pair and pair in postponed:
            graded.append(_void_prop(prop, "postponed"))
            continue
        if scheduled is not None and pair not in scheduled:
            graded.append(_void_prop(prop, "not_on_slate"))
            continue

        key = (iso, name_match_key(player))
        stats = actuals.get(key)

        if not stats:
            prop_team = team_key(prop.get("team") or "")
            if postseason_fetched is not None and name_match_key(player) in postseason_benched:
                # Verified player, team's final box score, and he is not in it.
                graded.append({
                    **prop,
                    "actual": None,
                    "result": RESULT_DNP,
                    "model_result": model_result(RESULT_DNP, prop.get("recommendation")),
                    "dnp_reason": "not_in_box_score",
                    "graded_at": utc_now_iso(),
                })
                continue
            if postseason_fetched is not None:
                # Otherwise postseason days are never DNP from absence: a blank,
                # wrong or unread page, or a player missing from his page's stat
                # table, is unknown. It stays missing until a verified row arrives.
                reason = (
                    "postseason_no_row" if name_match_key(player) in postseason_fetched
                    else "postseason_not_fetched"
                )
                missing.append({"player": player, "stat": stat, "odds_type": prop.get("odds_type"), "reason": reason})
                continue
            if prop_team and prop_team in teams_done:
                # Team has finals for this date but player has no log row → DNP
                entry = {
                    **prop,
                    "actual": None,
                    "result": RESULT_DNP,
                    "model_result": model_result(RESULT_DNP, prop.get("recommendation")),
                    "graded_at": utc_now_iso(),
                }
                graded.append(entry)
            else:
                missing.append({"player": player, "stat": stat, "odds_type": prop.get("odds_type"), "reason": "no_actuals_yet"})
            continue

        if not stat_key:
            missing.append({"player": player, "stat": stat, "reason": "unmapped_stat"})
            continue

        actual_val = stats.get(stat_key)
        if actual_val is None:
            missing.append({"player": player, "stat": stat, "reason": "stat_missing_on_row"})
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

    if missing and not (allow_partial_write and n_graded):
        status = "partial" if n_graded else "waiting"
        if not dry_run:
            write_partial_progress(
                "kbo",
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
            "missing": len(missing),
            "dry_run": dry_run,
        }

    if missing:
        # Partial allowed — still don't write recap.json per product rule
        status = "partial"
        if not dry_run:
            write_partial_progress(
                "kbo",
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
            "missing": len(missing),
            "dry_run": dry_run,
        }

    if dry_run:
        return {
            "status": "complete",
            "slate_date": format_mmddyyyy(d),
            "props_total": total,
            "props_graded": n_graded,
            "dry_run": True,
            "sample": graded[:2],
        }

    path = write_recap("kbo", d, graded)
    return {
        "status": "complete",
        "slate_date": format_mmddyyyy(d),
        "props_total": total,
        "props_graded": n_graded,
        "path": str(path),
    }


DEFAULT_CATCH_UP_DAYS = 3


def catch_up_dates(d: date, days: int) -> list[date]:
    """Earlier KST slate dates (d-1 … d-days) that have a slate but are not graded complete.

    Mirrors grade_wnba_day.catch_up_dates: scheduled runs can be dropped and
    grading rules can improve (e.g. a newly supported stat), so a day that
    missed its single "yesterday" window would otherwise stay partial forever.
    """
    out: list[date] = []
    for offset in range(1, max(0, days) + 1):
        prior = d - timedelta(days=offset)
        day_dir = memory_dir("kbo", prior)
        if not (day_dir / "slate.json").exists():
            continue
        meta = load_json(day_dir / "meta.json", default={}) or {}
        if meta.get("status") == "complete" and (day_dir / "recap.json").exists():
            continue
        out.append(prior)
    return sorted(out)


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Grade KBO memory slate for a KST date")
    parser.add_argument("--date", help="KST slate date mm/dd/YYYY or YYYY-MM-DD (default: yesterday KST)")
    parser.add_argument("--dry-run", action="store_true")
    parser.add_argument(
        "--regrade",
        action="store_true",
        help="Re-grade a day that already has recap.json. Only a complete result is written; waiting/partial never replaces a graded day.",
    )
    parser.add_argument(
        "--catch-up-days",
        type=int,
        default=None,
        help=(
            "Also grade up to N earlier KST dates whose slate is not yet complete "
            f"(default: {DEFAULT_CATCH_UP_DAYS} for scheduled runs without --date, 0 with --date)"
        ),
    )
    args = parser.parse_args(argv)

    d = parse_cli_date(args.date, yesterday_kst())
    catch_up = args.catch_up_days
    if catch_up is None:
        catch_up = 0 if args.date else DEFAULT_CATCH_UP_DAYS
    results = [grade_day(prior, dry_run=args.dry_run, regrade=args.regrade) for prior in catch_up_dates(d, catch_up)]
    results.append(grade_day(d, dry_run=args.dry_run, regrade=args.regrade))
    result = results if len(results) > 1 else results[0]
    print(json.dumps(result, indent=2))
    # Non-zero only on hard failure; waiting/partial are normal
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

"""Publish Phase 2 tuned formulas on the live boards, with a one-file rollback.

The switch is pipeline/projection_formula.json (`mode`: "tuned" or "current").
`CG_PROJECTION_FORMULA` overrides that file for a single process.

Only stats whose ml/params file says recommendation == "candidate" change.
Those are the fits shadow mode has been scoring. Stats marked keep_current
stay on the previous formula, even if a search left unused knobs in the file.

When a row is switched, the previous number is kept as baseline_projection
and the previous pick as baseline_recommendation. The site reads projection.
Shadow keeps grading baseline (old formula) against the tuned fit, so the
running comparison does not collapse into tuned-vs-tuned.
"""
from __future__ import annotations

import csv
import json
import os
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[1]
CONFIG_PATH = Path(__file__).resolve().parent / "projection_formula.json"
PARAMS_DIR = REPO_ROOT / "ml" / "params"
WNBA_DIR = REPO_ROOT / "kbo-props-ui" / "public" / "data" / "wnba"

# Edge required before the live KBO pick leaves PUSH. Same cutoffs the generators use.
KBO_THRESHOLDS = {
    "Strikeouts": 0.45,
    "Hits Allowed": 0.35,
    "Pitching Outs": 1.0,
    "Hits+Runs+RBIs": 0.3,
    "Total Bases": 0.3,
    "Fantasy Score": 0.5,
}

WNBA_HEADLINE = {
    "Points": "projPts",
    "Rebounds": "projReb",
    "Assists": "projAst",
    "3-PT Made": "projFg3m",
    "Steals": "projStl",
    "Blocks": "projBlk",
    "Blocked Shots": "projBlk",
    "Turnovers": "projTov",
    "Offensive Rebounds": "projOreb",
    "Defensive Rebounds": "projDreb",
    "Fantasy Score": "projFantasy",
    "Rebs+Asts": "projRebAst",
    "Reb+Asts": "projRebAst",
    "Pts+Rebs": "projPtsReb",
    "Pts+Asts": "projPtsAst",
    "Pts+Rebs+Asts": "projPtsRebAst",
}
WNBA_RATING_KEY = {
    "Points": "pts", "Rebounds": "reb", "Assists": "ast", "3-PT Made": "fg3m",
    "Steals": "stl", "Blocks": "blk", "Blocked Shots": "blk", "Turnovers": "tov",
    "Offensive Rebounds": "oreb", "Defensive Rebounds": "dreb", "Fantasy Score": "fantasy",
    "Rebs+Asts": "rebAst", "Reb+Asts": "rebAst", "Pts+Rebs": "ptsReb",
    "Pts+Asts": "ptsAst", "Pts+Rebs+Asts": "ptsRebAst",
}


def formula_mode() -> str:
    """tuned or current. Env wins over the committed config."""
    env = os.environ.get("CG_PROJECTION_FORMULA", "").strip().lower()
    if env in ("tuned", "current"):
        return env
    try:
        data = json.loads(CONFIG_PATH.read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return "current"
    mode = str(data.get("mode") or "").strip().lower()
    return mode if mode in ("tuned", "current") else "current"


def file_mode() -> str:
    """Mode written in the config file, ignoring the env override."""
    try:
        data = json.loads(CONFIG_PATH.read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return "current"
    mode = str(data.get("mode") or "").strip().lower()
    return mode if mode in ("tuned", "current") else "current"


def linear(cal: dict | None, value: float) -> float:
    if not cal:
        return float(value)
    return float(cal["a"]) + float(cal["b"]) * float(value)


def load_params(sport: str) -> dict[str, dict]:
    out = {}
    folder = PARAMS_DIR / sport
    if not folder.is_dir():
        return out
    for path in sorted(folder.glob("*.json")):
        try:
            payload = json.loads(path.read_text(encoding="utf-8"))
        except (OSError, ValueError):
            continue
        stat = payload.get("stat")
        if stat:
            payload["_file"] = f"ml/params/{sport}/{path.name}"
            out[stat] = payload
    return out


def candidate_params(sport: str, stat: str) -> dict | None:
    """Params to publish, or None when this stat stays on the previous formula."""
    if formula_mode() != "tuned":
        return None
    params = load_params(sport).get(stat)
    if not params or params.get("recommendation") != "candidate":
        return None
    return params


def kbo_side(edge, threshold: float, odds_type: str | None) -> str:
    if edge is None:
        return "NO LINE"
    if edge > threshold:
        return "OVER"
    if edge < -threshold:
        if str(odds_type or "standard") in ("demon", "goblin"):
            return "PUSH"
        return "UNDER"
    return "PUSH"


def attach_kbo_formula(row: dict, tuned: float | None, threshold: float, factors: dict | None = None) -> dict:
    """Record the pre-promotion pick, then replace projection when tuned is set.

    `row` must already hold the previous formula's projection and recommendation.
    """
    row["baseline_projection"] = row.get("projection")
    row["baseline_recommendation"] = row.get("recommendation")
    row["formula_mode"] = formula_mode()
    row["formula_applied"] = tuned is not None
    if tuned is None:
        return row
    line = row.get("line")
    proj = round(float(tuned), 2)
    try:
        edge = (proj - float(line)) if line is not None else None
    except (TypeError, ValueError):
        edge = None
    odds = row.get("odds_type") or "standard"
    rec = kbo_side(edge, threshold, odds)
    row["projection"] = proj
    row["edge"] = round(edge, 2) if edge is not None else None
    row["recommendation"] = rec
    row["rating"] = round((proj / float(line)) * 50, 1) if line else None
    from utils.cg_projection import calculate_cg_projection
    row["cg_projection"] = calculate_cg_projection(
        proj, line, edge if edge is not None else None, rec,
        row.get("hit_rate_l5"), row.get("hit_rate_full"), row.get("games_used") or 0,
    )
    for key, value in (factors or {}).items():
        if value is not None:
            row[key] = round(float(value), 3)
    return row


def _fixed_dedupe(games: list[dict]) -> list[dict]:
    """Collapse the live double-count (round(ip, 3) misses 5.33 vs 5.333)."""
    dedup = {}
    for game in games or []:
        dedup[(game.get("date"), game.get("so"), game.get("ha"))] = game
    return sorted(dedup.values(), key=lambda game: game.get("date") or "", reverse=True)


_LEAGUE_CACHE: dict[int, tuple] = {}


def _pitcher_league(games_by_name: dict) -> tuple:
    key = id(games_by_name)
    if key not in _LEAGUE_CACHE:
        from ml.kbo import formula
        flat = [game for games in games_by_name.values() for game in _fixed_dedupe(games)]
        _LEAGUE_CACHE[key] = formula.league_rates(flat)
    return _LEAGUE_CACHE[key]


def tune_kbo_pitcher(stat: str, games: list[dict], ctx: tuple, games_by_name: dict) -> dict | None:
    """Tuned pitcher projection, or None to keep the number the caller already computed."""
    params = candidate_params("kbo", stat)
    if not params:
        return None
    if len(ctx) != 4 or any(value is None or value == 0 for value in ctx):
        return None
    from ml.kbo import formula
    from ml.kbo.tune import FORM, pitcher_components, pitcher_project
    knobs = params["formula"]["knobs"]
    prior = _fixed_dedupe(games)
    comp = pitcher_components(prior) if prior else None
    if comp is None:
        return None
    value = linear(params.get("linear_calibration"), pitcher_project(stat, comp, _pitcher_league(games_by_name), ctx, knobs))
    if knobs.get("form") == "off" or FORM.get(knobs.get("form")) is None:
        form_factor = 1.0
    else:
        pair = {"Strikeouts": comp["so"], "Hits Allowed": comp["ha"], "Pitching Outs": comp["ip"]}[stat]
        recent, season = pair[0], pair[1]
        ratio = recent / season if recent and season and season > 0 else None
        form_factor = formula.clamp(ratio if ratio else 1.0, *FORM[knobs["form"]])
    defaults = formula.DEFAULT_PARAMS["pitcher"]
    opp_so, lg_so, opp_h, lg_h = ctx
    h_ratio = opp_h / lg_h - 1.0
    mult = knobs["opp_mult"]
    if stat == "Strikeouts":
        opp_factor = formula.clamp(1.0 + mult * defaults["k_opp_sens"] * (opp_so / lg_so - 1.0), *defaults["k_opp_clamp"])
    elif stat == "Hits Allowed":
        opp_factor = formula.clamp(1.0 + mult * defaults["h_opp_sens"] * h_ratio, *defaults["h_opp_clamp"])
    else:
        opp_factor = formula.clamp(1.0 + mult * defaults["outs_opp_sens"] * h_ratio, *defaults["outs_opp_clamp"])
    return {"value": value, "opp_factor": opp_factor, "form_factor": form_factor, "knobs": knobs}


def _hrr_games(rows: list[dict]) -> list[dict]:
    out = []
    for row in rows or []:
        def num(key):
            try:
                return int(float(row.get(key) or 0))
            except (TypeError, ValueError):
                return 0
        out.append({"AB": num("AB"), "Walks": num("Walks"), "HBP": num("HBP"),
                    "H": num("H"), "R": num("R"), "RBI": num("RBI")})
    return out


class _OppAllowed:
    """HRR allowed per game by each pitching staff, from the on-disk batting log."""

    def __init__(self, path: Path, season: int = 2026):
        from collections import defaultdict
        from ml.common.util import parse_date
        games = defaultdict(float)
        if path.exists():
            with path.open(encoding="utf-8-sig", newline="") as handle:
                for row in csv.DictReader(handle):
                    if str(row.get("Season", "")) != str(season):
                        continue
                    day = parse_date(row.get("DATE"))
                    if not day:
                        continue
                    def num(key, row=row):
                        try:
                            return int(float(row.get(key) or 0))
                        except (TypeError, ValueError):
                            return 0
                    games[(day, str(row.get("Team") or "").strip(), str(row.get("OPP") or "").strip())] += (
                        num("H") + num("R") + num("RBI")
                    )
        self.games = sorted(games.items())

    def factor(self, opp: str, sens: float = 0.50, lo: float = 0.88, hi: float = 1.12) -> float:
        from collections import defaultdict
        from ml.kbo import formula
        from ml.kbo.build_dataset import canon_team
        tot, cnt = defaultdict(float), defaultdict(int)
        for (_day, _team, opponent), hrr in self.games:
            tot[opponent] += hrr
            cnt[opponent] += 1
        n = sum(cnt.values())
        league = sum(tot.values()) / n if n else None
        rates = {opponent: tot[opponent] / cnt[opponent] for opponent in tot if cnt[opponent] >= 5}
        rate = next((value for opponent, value in rates.items() if canon_team(opponent) == canon_team(opp)), None)
        if not rate or not league:
            return 1.0
        return formula.clamp(1.0 + sens * (rate / league - 1.0), lo, hi)


_OPP_ALLOWED: _OppAllowed | None = None


def _opp_allowed() -> _OppAllowed:
    global _OPP_ALLOWED
    if _OPP_ALLOWED is None:
        _OPP_ALLOWED = _OppAllowed(REPO_ROOT / "Batters-Data" / "KBO_daily_batting_stats_combined.csv")
    return _OPP_ALLOWED


def tune_kbo_hrr(games: list[dict], factors: dict, opponent: str) -> dict | None:
    params = candidate_params("kbo", "Hits+Runs+RBIs")
    if not params:
        return None
    from ml.kbo.tune import hrr_project, hrr_windows
    windows = hrr_windows(_hrr_games(games))
    if windows is None:
        return None
    knobs = params["formula"]["knobs"]
    packed = dict(factors)
    packed["opp_corrected"] = _opp_allowed().factor(opponent)
    value = linear(params.get("linear_calibration"), hrr_project(windows, packed, knobs))
    shown = {
        "opp_factor": packed["opp_corrected"] if knobs.get("opp") == "corrected" else factors.get("opp_factor"),
        "park_factor": factors.get("park_factor") if knobs.get("park") else 1.0,
        "split_factor": factors.get("split_factor") if knobs.get("split") else 1.0,
        "pitcher_factor": factors.get("pitcher_factor") if knobs.get("pitcher") else 1.0,
    }
    return {"value": value, "factors": shown, "knobs": knobs}


def tune_kbo_published(stat: str, baseline: float | None) -> float | None:
    """Fantasy Score (and any other published-source candidate): a + b * current."""
    params = candidate_params("kbo", stat)
    if not params or baseline is None:
        return None
    knobs = params["formula"].get("knobs") or {}
    if knobs.get("source") not in (None, "published"):
        return None
    if not params.get("linear_calibration"):
        return None
    return linear(params.get("linear_calibration"), baseline)


def promote_nfl(stat: str, values: list[float], baseline: float | None) -> float | None:
    """Tuned NFL number rounded to 0.1, or None to keep `baseline`.

    Candidate stats whose knobs are still the live formula get a + b * baseline
    (what shadow calls current_x_calibration). Receiving Yards replays the
    chosen window and weights, then calibrates.
    """
    params = candidate_params("nfl", stat)
    if not params or baseline is None:
        return None
    knobs = params["formula"]["knobs"]
    if params["formula"].get("is_current", True):
        raw = float(baseline)
    else:
        from ml.nfl import formula
        from ml.nfl.tune import params_for
        raw = formula.projection(list(values), params_for(knobs))
        if raw is None:
            return None
    return round(linear(params.get("linear_calibration"), raw), 1)


def _wnba_logs() -> dict[str, list[dict]]:
    from collections import defaultdict
    import io
    from ml.wnba.replay import BOXSCORES, GAMELOG, _norm
    rows = []
    for rel, src in ((BOXSCORES, "boxscore"), (GAMELOG, "gamelog")):
        path = REPO_ROOT / rel
        if not path.exists():
            continue
        text = path.read_text(encoding="utf-8-sig")
        rows += [_norm(row, src) for row in csv.DictReader(io.StringIO(text))]
    seen, by_player = set(), defaultdict(list)
    for game in rows:
        if not game["player"] or not game["date"]:
            continue
        key = (game["player"].lower(), game["date"])
        if key in seen:
            continue
        seen.add(key)
        by_player[game["player"].lower()].append(game)
    for games in by_player.values():
        games.sort(key=lambda game: game["date"], reverse=True)
    return by_player


def tune_wnba(stat: str, games: list[dict], dvp: dict | None) -> float | None:
    params = candidate_params("wnba", stat)
    if not params or not games:
        return None
    from ml.wnba import formula
    from ml.wnba.tune import RowFeatures, components_for, project
    if formula.LABEL_TO_KEY.get(stat) is None:
        return None
    knobs = params["formula"]["knobs"]
    features = RowFeatures(games, components_for(stat), dvp or {})
    return round(linear(params.get("linear_calibration"), project(stat, features, knobs)), 2)


def _rating(projection, line):
    try:
        line_f = float(line)
        proj_f = float(projection)
    except (TypeError, ValueError):
        return None
    if line_f <= 0:
        return None
    return float(f"{(proj_f / line_f) * 50:.1f}")


def _apply_wnba_number(row: dict, stat: str, games: list[dict], dvp: dict) -> bool:
    """Rewrite one prop. Returns True when the published number is the tuned fit.

    Idempotent: a second pass keeps the stored baseline and recomputes tuned
    from the game log, so it does not calibrate an already-tuned number.
    """
    mode = formula_mode()
    if mode != "tuned":
        if row.get("formula_applied") and row.get("baseline_projection") is not None:
            row["projection"] = row["baseline_projection"]
            row["formula_applied"] = False
            row["formula_mode"] = "current"
            if "line" in row:
                row["rating"] = _rating(row["projection"], row.get("line"))
                rating = row["rating"]
                if rating is not None and "value" in row:
                    row["value"] = "OVER" if rating > 50 else "UNDER" if rating < 50 else "EVEN"
            return False
        row["formula_mode"] = "current"
        row["formula_applied"] = False
        return False
    tuned = tune_wnba(stat, games, dvp)
    if tuned is None:
        if not row.get("formula_applied"):
            row["formula_mode"] = mode
            row["formula_applied"] = False
        return False
    if not (row.get("formula_applied") and row.get("baseline_projection") is not None):
        row["baseline_projection"] = row.get("projection")
    row["projection"] = tuned
    row["formula_applied"] = True
    row["formula_mode"] = "tuned"
    if "line" in row:
        row["rating"] = _rating(tuned, row.get("line"))
        rating = row["rating"]
        if rating is not None and "value" in row:
            row["value"] = "OVER" if rating > 50 else "UNDER" if rating < 50 else "EVEN"
    return True


def apply_wnba_players(players: list[dict], logs: dict[str, list[dict]] | None = None) -> int:
    """Rewrite projection boards in place. Returns how many props switched to tuned."""
    logs = logs if logs is not None else _wnba_logs()
    switched = 0
    for player in players or []:
        if not isinstance(player, dict):
            continue
        name = str(player.get("name") or "").strip().lower()
        games = logs.get(name, [])
        dvp = player.get("dvpFactors") or {}
        player["formula_mode"] = formula_mode()
        by_stat = player.get("propProjectionByStat")
        if isinstance(by_stat, dict) and "baselinePropProjectionByStat" not in player:
            player["baselinePropProjectionByStat"] = dict(by_stat)
        if formula_mode() != "tuned" and isinstance(player.get("baselinePropProjectionByStat"), dict) and isinstance(by_stat, dict):
            by_stat.update(player["baselinePropProjectionByStat"])
            for stat, value in player["baselinePropProjectionByStat"].items():
                headline = WNBA_HEADLINE.get(stat)
                if headline:
                    player[headline] = value
        elif isinstance(by_stat, dict) and formula_mode() == "tuned":
            for stat in list(by_stat):
                tuned = tune_wnba(stat, games, dvp)
                if tuned is None:
                    continue
                by_stat[stat] = tuned
                headline = WNBA_HEADLINE.get(stat)
                if headline:
                    player[headline] = tuned
                rating_key = WNBA_RATING_KEY.get(stat)
                ratings = player.get("ppRating")
                if rating_key and isinstance(ratings, dict):
                    line = next((prop.get("line") for prop in player.get("ppAllProps") or [] if prop.get("stat") == stat), None)
                    if line is not None:
                        ratings[rating_key] = _rating(tuned, line)
        for prop in player.get("ppAllProps") or []:
            if _apply_wnba_number(prop, str(prop.get("stat") or ""), games, dvp):
                switched += 1
    return switched


def apply_wnba_edge(rows: list[dict], players: list[dict], logs: dict[str, list[dict]] | None = None) -> int:
    logs = logs if logs is not None else _wnba_logs()
    dvp_by_name = {}
    for player in players or []:
        if isinstance(player, dict) and player.get("name"):
            dvp_by_name[str(player["name"]).strip().lower()] = player.get("dvpFactors") or {}
    switched = 0
    for row in rows or []:
        if not isinstance(row, dict):
            continue
        name = str(row.get("name") or "").strip().lower()
        if _apply_wnba_number(row, str(row.get("stat") or ""), logs.get(name, []), dvp_by_name.get(name, {})):
            switched += 1
    return switched


def apply_wnba_files(directory: Path | None = None) -> dict:
    """Rewrite the exported WNBA snapshots the site publishes."""
    directory = Path(directory or WNBA_DIR)
    logs = _wnba_logs()
    summary = {"mode": formula_mode(), "files": {}, "switched": 0}
    standard_players: list[dict] = []
    for kind in ("standard", "demon", "goblin"):
        path = directory / f"projections_{kind}.json"
        if not path.exists():
            summary["files"][path.name] = "missing"
            continue
        players = json.loads(path.read_text(encoding="utf-8"))
        if not isinstance(players, list):
            summary["files"][path.name] = "skipped"
            continue
        n = apply_wnba_players(players, logs)
        path.write_text(json.dumps(players), encoding="utf-8")
        summary["files"][path.name] = n
        summary["switched"] += n
        if kind == "standard":
            standard_players = players
    edge_path = directory / "edge.json"
    if edge_path.exists():
        edge = json.loads(edge_path.read_text(encoding="utf-8"))
        if isinstance(edge, list):
            n = apply_wnba_edge(edge, standard_players, logs)
            edge_path.write_text(json.dumps(edge), encoding="utf-8")
            summary["files"]["edge.json"] = n
            summary["switched"] += n
    return summary


def copy_formula_fields(dest: dict, *sources: dict) -> dict:
    """Copy baseline / formula flags onto a slate row. Earlier sources win."""
    for source in sources:
        if not isinstance(source, dict):
            continue
        for key in ("baseline_projection", "baseline_recommendation", "formula_mode"):
            if dest.get(key) is None and source.get(key) is not None:
                dest[key] = source.get(key)
        if "formula_applied" not in dest and "formula_applied" in source:
            dest["formula_applied"] = bool(source.get("formula_applied"))
    return dest

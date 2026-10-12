"""Anytime goal scorer preview. This does not change the props board.

Each skater's even-strength and power-play goals per 60 are shrunk toward
the position average. Those rates are multiplied by tonight's expected ice
time (the same recent blend the shots model uses, then scaled for the
posted line or power-play unit). The total is adjusted for the opponent's
goals allowed and, when a starter is known, that goalie's save percentage
versus the league. lambda is expected goals. P(score) = 1 - exp(-lambda),
which is the Poisson chance of at least one goal.

CG Score is that probability scaled to 0-100. The props board score is
(projection / line) * 50. An anytime goal has no line yet, so 34.0 means
the model assigns about a 34% chance he scores.

Price to beat is the American odds whose no-vig implied probability equals
P(score). A 25% chance is +300. A 60% chance is -150. Exactly 50% is +100.

Rank 1 is the toughest matchup, same convention as defense vs position.
A team that allows fewer goals ranks ahead of a team that allows more.
A goalie with a higher save percentage ranks ahead of a worse goalie.

OUT, IR, LTIR, and scratched players are dropped from the lineup snapshot,
along with the manual ids on the props board. PR #131's NHL.com scratch
feed is not merged, so this preview does not call it. When that module
lands, drop_unavailable is applied as well.

    python -m nhl.ags --root /tmp/moneypuck
    python -m nhl.ags --root /tmp/moneypuck --recheck
"""
from __future__ import annotations

import argparse
import math
import re
import unicodedata
from collections import defaultdict
from datetime import datetime, timezone
from pathlib import Path

from nhl.build_board import (
    CURRENT_SEASON,
    EXCLUDED_PLAYER_IDS,
    _history_for,
    _index_players,
    _name_key,
    _usage,
    _write_if_ready,
    fetch_goalies,
    fetch_last_game_skaters,
    fetch_lines,
    fetch_schedule,
)
from nhl.history import load_goalies, load_skaters
from nhl.model import (
    PRIOR_PP_SECONDS,
    PRIOR_SECONDS,
    adjust_pp_seconds,
    blend_exposure,
    clamp,
    opponent_factor,
    shrunk_rate_per60,
)
from nhl.teams import team_abbr

# Position priors, used only before the league sample has any ice time.
DEFAULT_GOALS_PER60 = {
    "f_ev_g60": 0.65,
    "d_ev_g60": 0.18,
    "f_pp_g60": 2.2,
    "d_pp_g60": 0.85,
}
# A posted even-strength unit moves the recent average. None leaves it alone.
EV_LINE_FACTOR = {
    "F1": 1.12,
    "F2": 1.00,
    "F3": 0.82,
    "F4": 0.62,
    "D1": 1.10,
    "D2": 1.00,
    "D3": 0.78,
}
TEAM_GA_CLAMP = (0.85, 1.15)
GOALIE_CLAMP = (0.85, 1.15)
# Pretend the goalie has already faced this many league-average shots.
GOALIE_PRIOR_SHOTS = 500
# No odds feed yet. The page column stays behind this flag.
SHOW_ODDS = False
MODEL_NAME = "ags-v1"
RECHECK_NOTE = (
    "Manual warmup recheck. Run about 30 minutes before puck drop so the "
    "sheet can drop scratches and power-play changes. It is not scheduled. "
    "A clock for that rerun waits on launch approval."
)


def score_probability(lam: float) -> float:
    """P(at least one goal) for a Poisson count with mean `lam`."""
    if lam <= 0 or not math.isfinite(lam):
        return 0.0
    return 1.0 - math.exp(-lam)


def ags_cg_score(probability: float) -> float:
    """Model probability scaled to 0-100.

    0 is no chance. 100 is a goal the model treats as certain. 50 is a
    coin flip. This is not the props-board ratio (projection / line) * 50.
    """
    if not math.isfinite(probability):
        return 0.0
    return round(clamp(probability, 0.0, 1.0) * 100.0, 1)


def price_to_beat(probability: float) -> int | None:
    """Break-even American odds for `probability`. No vig.

    Positive odds: 100 * (1 - p) / p. Negative odds: -100 * p / (1 - p).
    A 50% chance is +100. A chance of 0 or 1 has no finite price.
    """
    if not math.isfinite(probability) or probability <= 0 or probability >= 1:
        return None
    if probability == 0.5:
        return 100
    if probability < 0.5:
        return _round_half_away(100.0 * (1.0 - probability) / probability)
    return -_round_half_away(100.0 * probability / (1.0 - probability))


def format_price(odds: int | None) -> str | None:
    if odds is None:
        return None
    if odds > 0:
        return f"+{odds}"
    return str(odds)


def _round_half_away(value: float) -> int:
    return int(math.floor(value + 0.5))


def adjust_ev_seconds(seconds: float, line: str | None) -> float:
    """Scale even-strength minutes for the posted line. None means unknown."""
    if line is None:
        return seconds
    factor = EV_LINE_FACTOR.get(str(line).upper())
    if factor is None:
        return seconds
    return seconds * factor


def _fold_key(name: str | None) -> str:
    """Match lineup spelling to MoneyPuck when the only difference is an accent.

    The props board key drops accented letters. This preview folds them to
    ASCII first, so Slafkovský still finds Slafkovsky. That lookup stays here.
    """
    text = unicodedata.normalize("NFKD", str(name or ""))
    text = "".join(ch for ch in text if not unicodedata.combining(ch))
    return _name_key(text)


def _index_folded(rows: list[dict]) -> dict[str, list[dict]]:
    """Index under the folded key and the props-board key.

    MoneyPuck sometimes deletes the accented letter (Stützle is stored as
    Sttzle) and sometimes keeps the ASCII letter (Slafkovsky). The lineup
    page keeps the accent. Both keys are stored so either file still hits.
    """
    by_name = defaultdict(list)
    for row in rows:
        keys = {_fold_key(row.get("name")), _name_key(row.get("name"))}
        for key in keys:
            if key:
                by_name[key].append(row)
    return by_name


def _history_folded(by_name: dict, name: str, team: str) -> list[dict]:
    rows = []
    for key in (_fold_key(name), _name_key(name)):
        rows = by_name.get(key) or []
        if rows:
            break
    if not rows:
        return []
    return _history_for({_name_key(name): rows}, name, team)


def blocked_status(value) -> str | None:
    """OUT, IR, LTIR, or scratched. A game-time decision stays on the board."""
    compact = re.sub(r"[^A-Z]", "", str(value or "").upper())
    if not compact:
        return None
    if "LTIR" in compact or compact in {"LONGTERMIR", "LONGTERMINJUREDRESERVE", "IRLT"}:
        return "LTIR"
    if compact in {"IR", "INJUREDRESERVE"}:
        return "IR"
    if compact == "OUT" or compact.startswith("OUT"):
        return "OUT"
    if "SCRATCH" in compact:
        return "SCRATCHED"
    return None


def shrunk_save_pct(saves: float, shots: float, league_sv: float, prior_shots: float = GOALIE_PRIOR_SHOTS) -> float:
    """Save percentage pulled toward the league until the goalie has a sample."""
    if not math.isfinite(league_sv):
        league_sv = 0.9
    league_sv = clamp(league_sv, 0.01, 0.99)
    if shots <= 0:
        return league_sv
    return (saves + league_sv * prior_shots) / (shots + prior_shots)


def goalie_scoring_factor(goalie_sv: float | None, league_sv: float | None) -> float:
    """Higher save percentage lowers expected goals. 1.0 is league average."""
    if goalie_sv is None or league_sv is None or not math.isfinite(goalie_sv) or not math.isfinite(league_sv):
        return 1.0
    goalie_ga = max(0.001, 1.0 - clamp(goalie_sv, 0.01, 0.99))
    league_ga = max(0.001, 1.0 - clamp(league_sv, 0.01, 0.99))
    return clamp(goalie_ga / league_ga, GOALIE_CLAMP[0], GOALIE_CLAMP[1])


def team_scoring_factor(team_ga60: float | None, league_ga60: float | None) -> float:
    """More goals allowed raises expected goals. 1.0 is league average."""
    return opponent_factor(team_ga60, league_ga60, TEAM_GA_CLAMP)


def expected_goals(ev_toi: float, ev_g60: float, pp_toi: float, pp_g60: float, team_factor: float, goalie_factor: float) -> float:
    lam = (max(0.0, ev_toi) / 3600.0) * max(0.0, ev_g60) + (max(0.0, pp_toi) / 3600.0) * max(0.0, pp_g60)
    return max(0.0, lam * team_factor * goalie_factor)


def rank_low_is_tougher(scores: dict[str, float]) -> dict[str, int]:
    """Rank 1 is the smallest score. Ties break by the key, so the order is stable."""
    ordered = sorted(scores, key=lambda key: (scores[key], str(key)))
    return {key: index for index, key in enumerate(ordered, start=1)}


def rank_high_is_tougher(scores: dict[str, float]) -> dict[str, int]:
    """Rank 1 is the largest score. A better save percentage is a tougher matchup."""
    ordered = sorted(scores, key=lambda key: (-scores[key], str(key)))
    return {key: index for index, key in enumerate(ordered, start=1)}


def _per60(count: float, seconds: float, fallback: float) -> float:
    if seconds <= 0:
        return fallback
    return count * 3600.0 / seconds


def position_goal_rates(skaters: list[dict]) -> dict:
    buckets = {key: [0.0, 0.0] for key in DEFAULT_GOALS_PER60}
    for game in skaters:
        group = "d" if game.get("pos") == "D" else "f"
        buckets[f"{group}_ev_g60"][0] += float(game.get("ev_goals") or 0)
        buckets[f"{group}_ev_g60"][1] += float(game.get("ev_toi") or 0)
        buckets[f"{group}_pp_g60"][0] += float(game.get("pp_goals") or 0)
        buckets[f"{group}_pp_g60"][1] += float(game.get("pp_toi") or 0)
    return {
        key: _per60(count, seconds, DEFAULT_GOALS_PER60[key])
        for key, (count, seconds) in buckets.items()
    }


def team_goals_allowed(goalie_rows: list[dict]) -> dict[str, float]:
    """Goals allowed per 60 by the team in front of the goalie."""
    totals: dict[str, list[float]] = defaultdict(lambda: [0.0, 0.0])
    for row in goalie_rows:
        team = team_abbr(row.get("team"))
        toi = float(row.get("toi") or 0)
        if not team or toi <= 0:
            continue
        totals[team][0] += float(row.get("ga") or 0)
        totals[team][1] += toi
    return {team: ga * 3600.0 / toi for team, (ga, toi) in totals.items() if toi > 0}


def league_save_pct(goalie_rows: list[dict]) -> float:
    shots = 0.0
    saves = 0.0
    for row in goalie_rows:
        sa = float(row.get("sa") or 0)
        if sa <= 0:
            continue
        shots += sa
        saves += float(row.get("saves") if row.get("saves") is not None else max(0.0, sa - float(row.get("ga") or 0)))
    if shots <= 0:
        return 0.9
    return clamp(saves / shots, 0.01, 0.99)


def _goalie_samples(goalie_rows: list[dict]) -> dict[str, dict]:
    samples: dict[str, dict] = {}
    for row in goalie_rows:
        player_id = str(row.get("player_id") or "")
        if not player_id:
            continue
        slot = samples.get(player_id)
        if slot is None:
            slot = {"saves": 0.0, "sa": 0.0, "name": row.get("name") or "", "games": []}
            samples[player_id] = slot
        sa = float(row.get("sa") or 0)
        slot["sa"] += sa
        slot["saves"] += float(row.get("saves") if row.get("saves") is not None else max(0.0, sa - float(row.get("ga") or 0)))
        slot["games"].append(row)
        if row.get("name"):
            slot["name"] = row["name"]
    return samples


def _pp_role(unit: str | None, source: str | None) -> str | None:
    if source == "last_game" or unit is None:
        return None
    return {"PP1": "pp1", "PP2": "pp2", "none": "none"}.get(unit)


def role_tag(line: str | None, pp_unit: str | None) -> str:
    parts = []
    if line:
        parts.append(line)
    if pp_unit == "PP1" or pp_unit == "PP2":
        parts.append(pp_unit)
    elif pp_unit == "none":
        parts.append("No PP")
    return " / ".join(parts)


def _scored_pct(rows: list[dict]) -> tuple[float | None, int]:
    played = [row for row in rows if row.get("goals") is not None]
    if not played:
        return None, 0
    scored = sum(1 for row in played if float(row.get("goals") or 0) > 0)
    return round(100.0 * scored / len(played), 1), len(played)


def unavailable_from_lines(lines: dict) -> tuple[set[str], set[str]]:
    """Names and ids carrying OUT, IR, LTIR, or scratched on the line sheet."""
    names: set[str] = set()
    ids: set[str] = set()
    for info in (lines or {}).values():
        for player in (info or {}).get("players") or []:
            if not blocked_status(player.get("injury") or player.get("status")):
                continue
            if player.get("name"):
                names.add(_name_key(player.get("name")))
            raw_id = player.get("playerId") or player.get("id")
            if raw_id is not None and str(raw_id).strip():
                ids.add(str(raw_id).strip())
    return names, ids


def is_excluded(player: str | None, player_id: str | None, blocked_names: set[str], blocked_ids: set[str], excluded_ids: set[str]) -> bool:
    pid = str(player_id or "").strip()
    if pid and (pid in excluded_ids or pid in blocked_ids):
        return True
    key = _name_key(player)
    return bool(key) and key in blocked_names


def _dress(info: dict | None) -> list[dict]:
    seen = {}
    for player in (info or {}).get("players") or []:
        if player.get("category") == "oi":
            continue
        if blocked_status(player.get("injury") or player.get("status")):
            continue
        group = str(player.get("group") or "").lower()
        if group in {"", "g"}:
            continue
        position = str(player.get("position") or "").upper()
        if position == "G":
            continue
        name = str(player.get("name") or "").strip()
        if not name:
            continue
        seen.setdefault(_name_key(name), player)
    return list(seen.values())


def _project_one(
    history: list[dict],
    *,
    group: str,
    rates: dict,
    line: str | None,
    pp_role: str | None,
    team_ga60: float | None,
    league_ga60: float | None,
    goalie_sv: float | None,
    league_sv: float | None,
) -> dict:
    ev_key = "d_ev_g60" if group == "D" else "f_ev_g60"
    pp_key = "d_pp_g60" if group == "D" else "f_pp_g60"
    ev_seconds = sum(float(row.get("ev_toi") or 0) for row in history)
    pp_seconds = sum(float(row.get("pp_toi") or 0) for row in history)
    ev_goals = sum(float(row.get("ev_goals") or 0) for row in history)
    pp_goals = sum(float(row.get("pp_goals") or 0) for row in history)
    ev_rate = shrunk_rate_per60(ev_goals, ev_seconds, rates.get(ev_key, DEFAULT_GOALS_PER60[ev_key]), PRIOR_SECONDS)
    pp_rate = shrunk_rate_per60(pp_goals, pp_seconds, rates.get(pp_key, DEFAULT_GOALS_PER60[pp_key]), PRIOR_PP_SECONDS)
    ev_toi = adjust_ev_seconds(blend_exposure(history, "ev_toi", CURRENT_SEASON), line)
    pp_toi = adjust_pp_seconds(blend_exposure(history, "pp_toi", CURRENT_SEASON), pp_role)
    team_factor = team_scoring_factor(team_ga60, league_ga60)
    goalie_factor = goalie_scoring_factor(goalie_sv, league_sv)
    lam = expected_goals(ev_toi, ev_rate, pp_toi, pp_rate, team_factor, goalie_factor)
    probability = score_probability(lam)
    shown = round(probability, 4)
    odds = price_to_beat(shown)
    return {
        "lambda": round(lam, 4),
        "probability": shown,
        "score": ags_cg_score(probability),
        "priceToBeat": odds,
        "priceToBeatText": format_price(odds),
        "evToi": round(ev_toi, 1),
        "ppToi": round(pp_toi, 1),
        "teamFactor": round(team_factor, 4),
        "goalieFactor": round(goalie_factor, 4),
    }


def _match_goalie(name: str | None, team: str, samples: dict[str, dict], by_goalie_name: dict) -> dict | None:
    if not name:
        return None
    history = _history_folded(by_goalie_name, name, team)
    if not history:
        return None
    player_id = str(history[-1].get("player_id") or "")
    return samples.get(player_id)


def build_rows(
    games: list[dict],
    lines: dict,
    goalie_page: dict,
    skaters: list[dict],
    goalie_rows: list[dict],
    excluded_ids: set[str] | None = None,
) -> tuple[list[dict], dict]:
    """One row per skater expected to dress. Goalies are not anytime scorers here."""
    excluded = {str(item) for item in (EXCLUDED_PLAYER_IDS if excluded_ids is None else excluded_ids)}
    blocked_names, blocked_ids = unavailable_from_lines(lines)
    rates = position_goal_rates(skaters)
    ga60 = team_goals_allowed(goalie_rows)
    league_ga = None
    ga_sum = toi_sum = 0.0
    for row in goalie_rows:
        toi = float(row.get("toi") or 0)
        if toi <= 0:
            continue
        ga_sum += float(row.get("ga") or 0)
        toi_sum += toi
    if toi_sum > 0:
        league_ga = ga_sum * 3600.0 / toi_sum
    league_sv = league_save_pct(goalie_rows)
    samples = _goalie_samples(goalie_rows)
    by_skater = _index_folded(skaters)
    by_goalie = _index_folded(goalie_rows)
    team_ranks = rank_low_is_tougher(ga60)

    # League-wide: rank 1 is the highest save percentage, the toughest goalie to score on.
    # A starter who is not in the logs has no rank. Tonight's posting does not renumber the rest.
    goalie_ranks_by_id = rank_high_is_tougher({
        player_id: shrunk_save_pct(sample["saves"], sample["sa"], league_sv)
        for player_id, sample in samples.items()
        if sample["sa"] >= 100
    })
    starters = {}
    for team, info in (goalie_page or {}).items():
        abbr = team_abbr(team)
        sample = _match_goalie((info or {}).get("name"), abbr, samples, by_goalie)
        if not sample:
            starters[abbr] = {"name": (info or {}).get("name"), "sv": None, "status": (info or {}).get("status"), "player_id": None}
            continue
        player_id = next((pid for pid, item in samples.items() if item is sample), None)
        starters[abbr] = {
            "name": sample["name"] or (info or {}).get("name"),
            "sv": shrunk_save_pct(sample["saves"], sample["sa"], league_sv),
            "status": (info or {}).get("status"),
            "player_id": player_id,
        }
    environments = {}
    for team in {team_abbr(side) for game in games for side in (game.get("away"), game.get("home"))}:
        if not team:
            continue
        goalie_sv = (starters.get(team) or {}).get("sv")
        environments[team] = team_scoring_factor(ga60.get(team), league_ga) * goalie_scoring_factor(goalie_sv, league_sv)
    matchup_ranks = rank_low_is_tougher(environments)

    rows = []
    missing_history = []
    missing_lines = []
    missing_goalies = []
    for game in games:
        for team, opponent, home in (
            (game.get("away"), game.get("home"), False),
            (game.get("home"), game.get("away"), True),
        ):
            team = team_abbr(team)
            opponent = team_abbr(opponent)
            info = lines.get(team)
            dressed = _dress(info)
            if not dressed:
                missing_lines.append(team)
                continue
            if not (goalie_page or {}).get(opponent):
                missing_goalies.append(opponent)
            starter = starters.get(opponent) or {}
            for player in dressed:
                name = player.get("name")
                history = _history_folded(by_skater, name, team)
                player_id = str(history[-1]["player_id"]) if history else str(player.get("playerId") or "")
                if is_excluded(name, player_id, blocked_names, blocked_ids, excluded):
                    continue
                if not history:
                    missing_history.append(f"{name} ({team})")
                    continue
                usage = _usage(name, info)
                group = "D" if history[-1].get("pos") == "D" or str(player.get("position") or "").upper() == "D" else "F"
                line = usage.get("line")
                pp_unit = usage.get("ppUnit")
                projected = _project_one(
                    history,
                    group=group,
                    rates=rates,
                    line=line,
                    pp_role=_pp_role(pp_unit, usage.get("source")),
                    team_ga60=ga60.get(opponent),
                    league_ga60=league_ga,
                    goalie_sv=starter.get("sv"),
                    league_sv=league_sv,
                )
                l10_pct, l10_n = _scored_pct(history[-10:])
                season_rows = [row for row in history if row.get("season") == CURRENT_SEASON]
                season_pct, season_n = _scored_pct(season_rows)
                recent_goals = [float(row.get("goals") or 0) for row in history[-10:]]
                rows.append({
                    "id": f"{player_id or _name_key(name)}-{game.get('id') or game.get('date')}",
                    "player": history[-1].get("name") or name,
                    "playerId": player_id or None,
                    "team": team,
                    "opponent": opponent,
                    "home": home,
                    "position": group,
                    "line": line,
                    "ppUnit": pp_unit,
                    "role": role_tag(line, pp_unit),
                    **projected,
                    "l10ScoredPct": l10_pct,
                    "l10Games": l10_n,
                    "seasonScoredPct": season_pct,
                    "seasonGames": season_n,
                    "seasonLabel": "2026-27",
                    "recentGoals": recent_goals,
                    "matchupRank": matchup_ranks.get(opponent),
                    "teamRank": team_ranks.get(opponent),
                    "goalieRank": goalie_ranks_by_id.get(starter.get("player_id")),
                    "goalie": starter.get("name"),
                    "goalieStatus": starter.get("status"),
                    "odds": None,
                    "gameday": game.get("date"),
                    "start_time": game.get("start"),
                    "awayTeam": game.get("away"),
                    "homeTeam": game.get("home"),
                })
    rows.sort(key=lambda row: (-(row.get("score") or 0), row.get("player") or ""))
    gaps = {
        "teamsWithoutLines": sorted(set(missing_lines)),
        "opponentsWithoutGoalie": sorted(set(missing_goalies)),
        "playersWithoutHistory": list(dict.fromkeys(missing_history)),
        "injuryFilter": "lineup OUT/IR/LTIR/scratched plus EXCLUDED_PLAYER_IDS; PR 131 is not merged",
        "showOdds": SHOW_ODDS,
    }
    return rows, gaps


def _apply_availability(rows: list[dict], games: list[dict], lines: dict) -> list[dict]:
    """Use PR #131's filter when that module is on this branch. It is not, today."""
    try:
        from nhl.availability import drop_unavailable
    except ImportError:
        return rows
    lineup_cards = []
    for game in games:
        injuries = {}
        for team in (game.get("away"), game.get("home")):
            hurt = []
            for player in (lines.get(team) or {}).get("players") or []:
                status = blocked_status(player.get("injury") or player.get("status"))
                if status and player.get("name"):
                    hurt.append({"name": player["name"], "status": status, "playerId": player.get("playerId")})
            if hurt:
                injuries[team] = hurt
        lineup_cards.append({"lineups": {}, "injuries": injuries, "id": game.get("id")})
    return drop_unavailable(rows, lineup_cards, games)


def build_payload(games, lines, goalie_page, skaters, goalie_rows, *, recheck: bool = False, excluded_ids=None) -> dict | None:
    if not games or not skaters:
        return None
    rows, gaps = build_rows(games, lines, goalie_page, skaters, goalie_rows, excluded_ids=excluded_ids)
    rows = _apply_availability(rows, games, lines)
    return {
        "generatedAt": datetime.now(timezone.utc).replace(microsecond=0).isoformat(),
        "model": MODEL_NAME,
        "recheck": recheck is True,
        "recheckNote": RECHECK_NOTE if recheck else None,
        "showOdds": SHOW_ODDS,
        "cgScore": "P(score) * 100. P(score) = 1 - exp(-lambda).",
        "rankNote": "Rank 1 is the toughest matchup.",
        "priceNote": "Price to beat is the American odds whose implied probability equals P(score).",
        "gaps": gaps,
        "records": rows,
    }


def build(root: Path, out_dir: Path, *, recheck: bool = False) -> int:
    try:
        games = fetch_schedule()
    except Exception as exc:  # noqa: BLE001 - keep the previous preview
        print(f"schedule failed, leaving the previous AGS file: {exc}")
        return 0
    slate_teams = {team for game in games for team in (game.get("away"), game.get("home")) if team}
    try:
        goalie_page, slugs = fetch_goalies()
    except Exception as exc:  # noqa: BLE001
        print(f"goalie page failed, starters stay unknown: {exc}")
        goalie_page, slugs = {}, {}
    from nhl.build_board import FACEOFF_SLUGS

    wanted = {team: FACEOFF_SLUGS[team] for team in slate_teams if team in FACEOFF_SLUGS}
    for team, slug in slugs.items():
        if team in slate_teams and slug:
            wanted[team] = slug
    lines = fetch_lines(wanted) if wanted else {}
    for team in sorted(slate_teams):
        if _dress(lines.get(team)):
            continue
        fallback = fetch_last_game_skaters(team)
        if fallback:
            print(f"ags lines {team}: no projected skaters, last game {fallback.get('gameDate')}")
            lines[team] = fallback
        else:
            print(f"ags lines {team}: no skaters posted")
    skaters = load_skaters(root, ("2025", "2026"))
    goalie_rows = load_goalies(root, ("2025", "2026"))
    payload = build_payload(games, lines, goalie_page, skaters, goalie_rows, recheck=recheck)
    ready = payload is not None and bool(payload.get("records"))
    if payload is None:
        print(f"No MoneyPuck skater files under {root}; leaving the previous AGS file")
    out_dir.mkdir(parents=True, exist_ok=True)
    _write_if_ready(out_dir / "ags.json", payload or {"records": []}, ready)
    if payload:
        print({
            "games": len(games),
            "rows": len(payload["records"]),
            "recheck": payload["recheck"],
            "gaps": payload["gaps"],
        })
    return 0


def main(argv=None) -> int:
    parser = argparse.ArgumentParser(description="Build the admin-only NHL anytime goal scorer preview")
    parser.add_argument("--root", type=Path, default=Path("/tmp/moneypuck"))
    parser.add_argument("--out", type=Path, default=Path(__file__).resolve().parents[1] / "nhl")
    parser.add_argument(
        "--recheck",
        action="store_true",
        help="Manual warmup rerun. Refreshes lineups and drops scratches or PP changes. Not scheduled.",
    )
    args = parser.parse_args(argv)
    return build(args.root, args.out, recheck=args.recheck)


if __name__ == "__main__":
    raise SystemExit(main())

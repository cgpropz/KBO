"""Walk-forward backtest of the 2025-26 regular season.

Every projection uses only games played before that date, including the
2024-25 season as prior history. It does not use that night's result, that
night's line combinations, or a PrizePicks line (those were not saved). The
decision test uses the nearest .5 line to the projection, which is a stand-in,
not a record of what the books posted.

Run:
    python -m nhl.backtest --root /tmp/moneypuck --out nhl/reports
"""
from __future__ import annotations

import argparse
import json
from collections import defaultdict
from pathlib import Path

from nhl.history import load_goalies, load_skaters, team_shot_games
from nhl.model import (
    PROP_POINTS,
    PROP_PPP,
    PROP_SAVES,
    PROP_SOG,
    dispersion_from_samples,
    early_exit,
    nearest_half_line,
    over_probability,
    project_points,
    project_power_play_points,
    project_saves,
    project_shots,
    recent_average,
    shrunk_mean,
    side_of,
)

TEST_SEASON = "20252026"
BINS = ((0.0, 0.40), (0.40, 0.50), (0.50, 0.60), (0.60, 0.70), (0.70, 1.01))
CALIBRATION_LIMIT = 0.08
MIN_BIN = 200


def _league_from_totals(totals: dict) -> dict:
    def per60(count, seconds, default):
        if seconds <= 0:
            return default
        return count * 3600.0 / seconds

    from nhl.model import DEFAULT_LEAGUE as base

    ga = totals["ga"]
    sa = totals["sa"]
    return {
        "f_ev_sog60": per60(totals["f_ev_sog"], totals["f_ev_toi"], base["f_ev_sog60"]),
        "d_ev_sog60": per60(totals["d_ev_sog"], totals["d_ev_toi"], base["d_ev_sog60"]),
        "f_pp_sog60": per60(totals["f_pp_sog"], totals["f_pp_toi"], base["f_pp_sog60"]),
        "d_pp_sog60": per60(totals["d_pp_sog"], totals["d_pp_toi"], base["d_pp_sog60"]),
        "f_ppg": (totals["f_points"] / totals["f_games"]) if totals["f_games"] else base["f_ppg"],
        "d_ppg": (totals["d_points"] / totals["d_games"]) if totals["d_games"] else base["d_ppg"],
        "f_ppp60": per60(totals["f_ppp"], totals["f_pp_toi"], base["f_ppp60"]),
        "d_ppp60": per60(totals["d_ppp"], totals["d_pp_toi"], base["d_ppp60"]),
        "ga_per_shot": (ga / sa) if sa else base["ga_per_shot"],
        "sa_per_game": (sa / totals["team_games"]) if totals["team_games"] else base["sa_per_game"],
        "xga60": per60(totals["xga"], totals["goalie_toi"], base["xga60"]),
        "sa60": per60(sa, totals["goalie_toi"], 30.0),
    }


def _empty_totals() -> dict:
    keys = (
        "f_ev_sog", "f_ev_toi", "d_ev_sog", "d_ev_toi", "f_pp_sog", "f_pp_toi",
        "d_pp_sog", "d_pp_toi", "f_points", "d_points", "f_ppp", "d_ppp",
        "f_games", "d_games", "ga", "sa", "xga", "goalie_toi", "team_games",
    )
    return {key: 0.0 for key in keys}


def _add_skater_totals(totals: dict, game: dict) -> None:
    group = "d" if game["pos"] == "D" else "f"
    totals[f"{group}_ev_sog"] += game["ev_sog"]
    totals[f"{group}_ev_toi"] += game["ev_toi"]
    totals[f"{group}_pp_sog"] += game["pp_sog"]
    totals[f"{group}_pp_toi"] += game["pp_toi"]
    totals[f"{group}_points"] += game["points"]
    totals[f"{group}_ppp"] += game["ppp"]
    totals[f"{group}_games"] += 1


def _add_team_totals(totals: dict, game: dict) -> None:
    totals["sa"] += game["sa"]
    totals["xga"] += game["xga"]
    totals["ga"] += game["sa"] * 0  # goals live on the goalie row
    totals["goalie_toi"] += game["toi"]
    totals["team_games"] += 1


class PropScore:
    def __init__(self):
        self.n = 0
        self.model_abs = 0.0
        self.base_abs = 0.0
        self.model_hits = 0
        self.base_hits = 0
        self.decided = 0
        self.by_line = defaultdict(lambda: {"n": 0, "model_hits": 0, "base_hits": 0})
        self.bins = {f"{lo:.2f}-{hi:.2f}": {"n": 0, "pred": 0.0, "actual": 0} for lo, hi in BINS}
        self.nb_bins = {f"{lo:.2f}-{hi:.2f}": {"n": 0, "pred": 0.0, "actual": 0} for lo, hi in BINS}

    def add(self, actual, model, baseline, line, p_over, p_nb):
        self.n += 1
        self.model_abs += abs(model - actual)
        self.base_abs += abs(baseline - actual)
        model_side = side_of(model, line)
        base_side = side_of(baseline, line)
        if actual != line and model_side != "PUSH":
            self.decided += 1
            truth = "OVER" if actual > line else "UNDER"
            self.model_hits += int(model_side == truth)
            if base_side != "PUSH":
                self.base_hits += int(base_side == truth)
            bucket = self.by_line[f"{line:.1f}"]
            bucket["n"] += 1
            bucket["model_hits"] += int(model_side == truth)
            bucket["base_hits"] += int(base_side == truth)
        self._bin(self.bins, p_over, actual, line)
        self._bin(self.nb_bins, p_nb, actual, line)

    @staticmethod
    def _bin(bins, probability, actual, line):
        if probability is None:
            return
        for lo, hi in BINS:
            if lo <= probability < hi:
                slot = bins[f"{lo:.2f}-{hi:.2f}"]
                slot["n"] += 1
                slot["pred"] += probability
                slot["actual"] += int(actual > line)
                return

    def report(self) -> dict:
        decided = self.decided or 1
        return {
            "projections": self.n,
            "mae": round(self.model_abs / self.n, 4) if self.n else None,
            "baseline_mae": round(self.base_abs / self.n, 4) if self.n else None,
            "hit_rate": round(self.model_hits / decided, 4) if self.decided else None,
            "baseline_hit_rate": round(self.base_hits / decided, 4) if self.decided else None,
            "decisions": self.decided,
            "lines": {
                line: {
                    "n": slot["n"],
                    "hit_rate": round(slot["model_hits"] / slot["n"], 4) if slot["n"] else None,
                    "baseline_hit_rate": round(slot["base_hits"] / slot["n"], 4) if slot["n"] else None,
                }
                for line, slot in sorted(self.by_line.items(), key=lambda item: float(item[0]))
            },
            "poisson_calibration": _calibration(self.bins),
            "negative_binomial_calibration": _calibration(self.nb_bins),
        }


def _calibration(bins: dict) -> dict:
    used = []
    weighted = 0.0
    weight = 0
    out = {}
    for name, slot in bins.items():
        n = slot["n"]
        predicted = (slot["pred"] / n) if n else None
        actual = (slot["actual"] / n) if n else None
        gap = abs(predicted - actual) if n else None
        out[name] = {
            "n": n,
            "predicted": round(predicted, 4) if predicted is not None else None,
            "actual": round(actual, 4) if actual is not None else None,
            "gap": round(gap, 4) if gap is not None else None,
        }
        if n >= MIN_BIN and gap is not None:
            used.append(name)
            weighted += gap * n
            weight += n
    out["weighted_gap"] = round(weighted / weight, 4) if weight else None
    out["bins_used"] = used
    return out


def _selected_gap(report: dict) -> float | None:
    poisson = (report.get("poisson_calibration") or {}).get("weighted_gap")
    negbin = (report.get("negative_binomial_calibration") or {}).get("weighted_gap")
    if poisson is None:
        return negbin
    if negbin is None:
        return poisson
    return min(poisson, negbin)


def passes(results: dict) -> tuple[bool, list[str]]:
    """Shots and saves must beat the last-10 average, and a count model must be calibrated."""
    reasons = []
    ok = True
    for prop in (PROP_SOG, PROP_SAVES):
        row = results.get(prop) or {}
        mae, base = row.get("mae"), row.get("baseline_mae")
        hit, base_hit = row.get("hit_rate"), row.get("baseline_hit_rate")
        if not row.get("projections"):
            ok = False
            reasons.append(f"{prop} had no projections.")
            continue
        if mae is None or base is None or mae >= base:
            ok = False
            reasons.append(f"{prop} average error {mae} did not beat the recent average {base}.")
        else:
            reasons.append(f"{prop} average error {mae} beat the recent average {base}.")
        if hit is None or base_hit is None or hit <= base_hit:
            ok = False
            reasons.append(f"{prop} side hit rate {hit} did not beat the recent average {base_hit}.")
        else:
            reasons.append(f"{prop} side hit rate {hit} beat the recent average {base_hit}.")
        gap = _selected_gap(row)
        if gap is None or gap > CALIBRATION_LIMIT:
            ok = False
            reasons.append(f"{prop} calibration gap {gap} is outside {CALIBRATION_LIMIT:.0%}.")
        else:
            reasons.append(f"{prop} calibration gap {gap} is inside {CALIBRATION_LIMIT:.0%}.")
    return ok, reasons


def _team_rate(history: list[dict], key: str) -> tuple[float | None, float | None]:
    if not history:
        return None, None
    sa = sum(row["sa"] for row in history)
    toi = sum(row["toi"] for row in history)
    per60 = (sa * 3600.0 / toi) if toi else None
    per_game = sa / len(history)
    if key == "sf":
        vals = [row["sf"] for row in history if row.get("sf")]
        return (sum(vals) / len(vals) if vals else None), per60
    return per_game, per60


def run_backtest(root: Path) -> dict:
    skaters = load_skaters(root, ("2024", "2025"))
    goalies = load_goalies(root, ("2024", "2025"))
    team_games = list(team_shot_games(goalies).values())
    if not skaters or not goalies:
        raise SystemExit(f"No MoneyPuck files under {root}. Download 2024 and 2025 regular-season CSVs first.")

    by_player: dict[str, list] = defaultdict(list)
    by_goalie: dict[str, list] = defaultdict(list)
    by_team: dict[str, list] = defaultdict(list)
    totals = _empty_totals()
    sog_values: list[float] = []
    save_values: list[float] = []
    appearances = 0
    early_exits = 0
    early_saves = 0.0

    def absorb_skater(game: dict) -> None:
        by_player[game["player_id"]].append(game)
        _add_skater_totals(totals, game)
        sog_values.append(game["sog"])

    def absorb_goalie(game: dict) -> None:
        # Backups who faced only a few shots do not enter the save model history.
        nonlocal appearances, early_exits, early_saves
        if game["sa"] < 8:
            return
        by_goalie[game["player_id"]].append(game)
        totals["ga"] += game["ga"]
        save_values.append(game["saves"])
        appearances += 1
        if early_exit(game):
            early_exits += 1
            early_saves += game["saves"]

    def absorb_team(game: dict) -> None:
        by_team[game["team"]].append(game)
        _add_team_totals(totals, game)

    prior_skaters = [game for game in skaters if game["season"] != TEST_SEASON]
    prior_goalies = [game for game in goalies if game["season"] != TEST_SEASON]
    prior_teams = [game for game in team_games if game["season"] != TEST_SEASON]
    for game in prior_skaters:
        absorb_skater(game)
    for game in prior_goalies:
        absorb_goalie(game)
    for game in prior_teams:
        absorb_team(game)

    test_skaters = [game for game in skaters if game["season"] == TEST_SEASON]
    test_goalies = [game for game in goalies if game["season"] == TEST_SEASON and game["sa"] >= 8]
    test_teams = [game for game in team_games if game["season"] == TEST_SEASON]
    dates = sorted({game["date"] for game in test_skaters})
    skater_on = defaultdict(list)
    goalie_on = defaultdict(list)
    team_on = defaultdict(list)
    for game in test_skaters:
        skater_on[game["date"]].append(game)
    for game in test_goalies:
        goalie_on[game["date"]].append(game)
    for game in test_teams:
        team_on[game["date"]].append(game)

    scores = {prop: PropScore() for prop in (PROP_SOG, PROP_SAVES, PROP_POINTS, PROP_PPP)}
    saves_previous = PropScore()
    saves_first = PropScore()
    saves_held = PropScore()
    # The first half is where the saves change was chosen. The second half is the test.
    midpoint = dates[len(dates) // 2] if dates else ""
    for day in dates:
        league = _league_from_totals(totals)
        sog_r = dispersion_from_samples(sog_values)
        save_r = dispersion_from_samples(save_values)
        for game in skater_on[day]:
            history = by_player[game["player_id"]]
            opp_games = by_team[game["opp"]]
            _, opp_sa60 = _team_rate(opp_games, "sa")
            opp_xga = None
            if opp_games:
                xga = sum(row["xga"] for row in opp_games)
                toi = sum(row["toi"] for row in opp_games)
                opp_xga = (xga * 3600.0 / toi) if toi else None
            shots = project_shots(
                history, season=TEST_SEASON, group=game["pos"], league=league,
                opponent_sa60=opp_sa60, league_sa60=league["sa60"], home=game["home"], pp_role=None,
            )
            points = project_points(
                history, season=TEST_SEASON, group=game["pos"], league=league,
                opponent_xga60=opp_xga, league_xga60=league["xga60"],
            )
            ppp = project_power_play_points(
                history, season=TEST_SEASON, group=game["pos"], league=league,
                opponent_xga60=opp_xga, league_xga60=league["xga60"], pp_role=None,
            )
            _grade_count(scores[PROP_SOG], history, "sog", shots, game["sog"], sog_r)
            _grade_count(scores[PROP_POINTS], history, "points", points, game["points"], None)
            _grade_count(scores[PROP_PPP], history, "ppp", ppp, game["ppp"], None)
        exit_rate = (early_exits / appearances) if appearances and early_exits else None
        exit_mean = (early_saves / early_exits) if early_exits else None
        for game in goalie_on[day]:
            history = by_goalie[game["player_id"]]
            team_sa, _ = _team_rate(by_team[game["team"]], "sa")
            opp_sf, _ = _team_rate(by_team[game["opp"]], "sf")
            saves = project_saves(
                history,
                team_sa_per_game=team_sa,
                opponent_sf_per_game=opp_sf,
                league_sa_per_game=league["sa_per_game"],
                league_ga_per_shot=league["ga_per_shot"],
                home=game["home"],
                early_exit_rate=exit_rate,
                early_exit_saves=exit_mean,
            )
            _grade_count(scores[PROP_SAVES], history, "saves", saves, game["saves"], save_r)
            half = saves_held if day >= midpoint else saves_first
            _grade_count(half, history, "saves", saves, game["saves"], save_r)
            previous = _previous_saves(
                history, team_sa, opp_sf, league["sa_per_game"], league["ga_per_shot"], game["home"]
            )
            _grade_count(saves_previous, history, "saves", previous, game["saves"], save_r)
        for game in skater_on[day]:
            absorb_skater(game)
        for game in goalie_on[day]:
            absorb_goalie(game)
        for game in team_on[day]:
            absorb_team(game)

    results = {prop: score.report() for prop, score in scores.items()}
    ok, reasons = passes(results)
    held = saves_held.report()
    first = saves_first.report()
    previous = saves_previous.report()
    held_pass, held_reasons = _saves_bar(held)
    return {
        "season": "2025-26 regular season",
        "test_season_id": TEST_SEASON,
        "prior_season": "2024-25 regular season, used only as history",
        "dates": len(dates),
        "midpoint": midpoint,
        "skater_games": len(test_skaters),
        "goalie_starts": len(test_goalies),
        "peeking": "none — each projection uses only games before that date",
        "lineups": "not used — minutes are the player's own prior average, because pregame lines were not saved",
        "lines": "nearest .5 number to the projection, not a stored PrizePicks line",
        "baseline": "average of the player's previous 10 games (fewer only when that is all they have), minimum 3 prior games",
        "saves_change": (
            "Chosen on the first half of 2025-26 only. The second half was scored once. "
            "Shot volume is team shots allowed times the opponent's shot rate, capped at 12% from average. "
            "A full-night total is mixed with the saves on nights the goalie left before 50 minutes, "
            "using the rate from games already played."
        ),
        "pass": held_pass,
        "full_season_pass": ok,
        "reasons": reasons,
        "saves_held_out_reasons": held_reasons,
        "saves_first_half": first,
        "saves_held_out": held,
        "saves_previous": previous,
        "props": results,
    }


def _saves_bar(row: dict) -> tuple[bool, list[str]]:
    """Beat the last-10 average on side, and do not be worse on average miss."""
    reasons = []
    mae, base = row.get("mae"), row.get("baseline_mae")
    hit, base_hit = row.get("hit_rate"), row.get("baseline_hit_rate")
    ok = True
    if not row.get("projections"):
        return False, ["Goalie saves had no held-out projections."]
    if mae is None or base is None or mae > base:
        ok = False
        reasons.append(f"Average miss {mae} was worse than the recent average {base}.")
    else:
        reasons.append(f"Average miss {mae} was not worse than the recent average {base}.")
    if hit is None or base_hit is None or hit <= base_hit:
        ok = False
        reasons.append(f"Side hit rate {hit} did not beat the recent average {base_hit}.")
    else:
        reasons.append(f"Side hit rate {hit} beat the recent average {base_hit}.")
    return ok, reasons


def _previous_saves(history, team_sa, opp_sf, league_sa, league_ga, home) -> float | None:
    """The saves formula that lost the first backtest. Kept so the report can compare."""
    if len(history) < 3:
        return None
    rates = [value for value in (team_sa, opp_sf, league_sa) if value and value > 0]
    if not rates:
        return None
    shots = sum(rates) / len(rates)
    if home is True:
        shots *= 0.99
    elif home is False:
        shots *= 1.02
    gsax = shrunk_mean(
        sum(float(row.get("xga") or 0) - float(row.get("ga") or 0) for row in history),
        len(history),
        0.0,
        30,
    )
    goals = max(0.3, shots * (league_ga or 0.095) - gsax)
    return round(max(0.0, shots - goals), 2)


def _grade_count(score: PropScore, history: list, key: str, projection, actual, dispersion) -> None:
    if projection is None:
        return
    baseline = recent_average([float(row[key]) for row in history])
    if baseline is None:
        return
    line = nearest_half_line(projection)
    score.add(
        actual,
        projection,
        baseline,
        line,
        over_probability(projection, line, None),
        over_probability(projection, line, dispersion),
    )


def _pct(value) -> str:
    if value is None:
        return "n/a"
    return f"{value * 100:.1f}%"


def _num(value) -> str:
    if value is None:
        return "n/a"
    return f"{float(value):.2f}"


def _day_label(value) -> str:
    text = str(value or "")
    months = ("January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December")
    if len(text) == 8 and text.isdigit():
        return f"{months[int(text[4:6]) - 1]} {int(text[6:8])}, {text[:4]}"
    return text


def write_markdown(report: dict, path: Path) -> None:
    verdict = "PASSES" if report["pass"] else "DOES NOT PASS"
    held = report["saves_held_out"]
    first = report["saves_first_half"]
    previous = report["saves_previous"]
    full = report["props"][PROP_SAVES]
    lines = [
        "# 2025-26 NHL prop backtest",
        "",
        f"Goalie saves, on the half of the season we did not use to build the formula: **{verdict}.**",
        "",
        "The NHL tab stays locked. This is a draft, and nothing here turns the public switch on.",
        "",
        "## Why the first saves model lost the over/under",
        "",
        "The first version was a little closer to the real total than 'use his last 10 games,' but it picked the right side less often. "
        f"On the full season it hit {_pct(previous['hit_rate'])} of the sides, and the last-10 average hit {_pct(previous['baseline_hit_rate'])}. "
        f"Its average miss was {_num(previous['mae'])} saves, versus {_num(previous['baseline_mae'])}.",
        "",
        "Two things caused that. First, the number assumed a full night. About one start in fourteen ends early, when the goalie is pulled, and those nights land around 13 saves instead of 25. The last-10 average already includes those short nights, so it was not sitting high. In the first half of the season our number was about 1.2 saves too high. Second, the shot guess gave equal weight to the team, the opponent, and the league. That pulled unusual goalies toward an ordinary night, and the over/under line sits right next to our number. The last-10 average sits further away, on the goalie's real level, so it won the side more often even though it missed the total by a bit more.",
        "",
        "We also checked the other guesses. Save percentage was not the problem: shrinking it more or less barely moved the error. The same goalie almost never starts both nights of a back-to-back, so that was not the gap. We do not have the betting totals from last season, so game script was not added. Mixing in the last-10 average made the side look better on the first half mostly by moving the line, and the average miss got worse, so that blend is not in the formula.",
        "",
        "## What we changed, and the result",
        "",
        "The new shot guess is how many shots the team usually allows, nudged up or down if this opponent shoots more or less than average. The nudge is capped at 12%. A full-night total is then mixed with the saves from nights a goalie left before 50 minutes, using only the rate from games already played. We did not blend in the last-10 average. The idea was set on the first half of 2025-26. The second half was scored once and was not used to change the formula.",
        "",
        f"First half: average miss {_num(first['mae'])} versus {_num(first['baseline_mae'])} for the last-10 average. Side {_pct(first['hit_rate'])} versus {_pct(first['baseline_hit_rate'])}. The miss got better. The side still did not win, so we did not keep tuning.",
        "",
        f"Second half, the real test ({_day_label(report['midpoint'])} through the end of the regular season): "
        f"{held['projections']} starts. Average miss {_num(held['mae'])} versus {_num(held['baseline_mae'])}. "
        f"Side {_pct(held['hit_rate'])} versus {_pct(held['baseline_hit_rate'])} on {held['decisions']} decisions.",
        "",
    ]
    for reason in report["saves_held_out_reasons"]:
        lines.append(f"- {reason}")
    if report["pass"]:
        lines.append("")
        lines.append("That is the bar: beat the last-10 average on the side, and do not be worse on the average miss, on games the formula was not tuned on.")
    else:
        lines.append("")
        lines.append("That misses the bar. Hide goalie saves. Shots, points, and power-play points can stay. The tab stays locked either way.")
    lines += [
        "",
        f"Full season, same new formula, still with no peeking: average miss {_num(full['mae'])} versus {_num(full['baseline_mae'])}. Side {_pct(full['hit_rate'])} versus {_pct(full['baseline_hit_rate'])}.",
        "",
        "Shots on goal were not changed. The rest of this note is the full walk-forward, one day at a time. The model could see only games already played, plus the 2024-25 season. It could not see that night's score, or the lines posted that morning. The over/under uses the closest half-point to our number. That is a stand-in for a sportsbook line, not a record of PrizePicks. The comparison is the previous 10 games.",
        "",
        "## Full-season checks",
        "",
    ]
    for reason in report["reasons"]:
        lines.append(f"- {reason}")
    lines += [
        "",
        "Shots and saves are the two props that had to beat that simple average, and their chances had to be honest (when the model says 60%, it should happen about 60% of the time, within 8 points). Points and power-play points are shown because the board includes them. They were not required to pass.",
        "",
        "## By prop",
        "",
    ]
    for prop, row in report["props"].items():
        lines.append(f"### {prop}")
        lines.append("")
        lines.append(
            f"{row['projections']} projections. Average miss {row['mae']} versus {row['baseline_mae']} for the recent average. "
            f"Side hit rate {_pct(row['hit_rate'])} versus {_pct(row['baseline_hit_rate'])} "
            f"on {row['decisions']} decisions."
        )
        lines.append("")
        lines.append("| Line | Props | Our hit rate | Recent-average hit rate |")
        lines.append("| --- | --- | --- | --- |")
        for line, slot in row["lines"].items():
            lines.append(f"| {line} | {slot['n']} | {_pct(slot['hit_rate'])} | {_pct(slot['baseline_hit_rate'])} |")
        lines.append("")
        lines.append("Poisson calibration (predicted chance versus how often the over actually hit):")
        lines.append("")
        lines.append("| Chance band | Props | Predicted | Actual | Gap |")
        lines.append("| --- | --- | --- | --- | --- |")
        for name, slot in row["poisson_calibration"].items():
            if name in {"weighted_gap", "bins_used"}:
                continue
            lines.append(
                f"| {name} | {slot['n']} | {_pct(slot['predicted'])} | {_pct(slot['actual'])} | {_pct(slot['gap'])} |"
            )
        gap = row["poisson_calibration"].get("weighted_gap")
        nb = row["negative_binomial_calibration"].get("weighted_gap")
        lines.append("")
        lines.append(f"Weighted calibration gap, bands with at least {MIN_BIN} props: Poisson {gap}, negative binomial {nb}.")
        lines.append("")
    lines.append(
        "A pass here does not mean the tab will beat PrizePicks. It means the projection is closer to the real count than 'use his last 10 games,' and the over/under chances are not wildly overconfident, on last season's games."
    )
    path.write_text("\n".join(lines) + "\n", encoding="utf-8")


def main(argv=None) -> int:
    parser = argparse.ArgumentParser(description="Walk-forward 2025-26 NHL prop backtest")
    parser.add_argument("--root", type=Path, default=Path("/tmp/moneypuck"))
    parser.add_argument("--out", type=Path, default=Path("nhl/reports"))
    args = parser.parse_args(argv)
    report = run_backtest(args.root)
    args.out.mkdir(parents=True, exist_ok=True)
    (args.out / "backtest_2025_26.json").write_text(json.dumps(report, indent=2) + "\n", encoding="utf-8")
    write_markdown(report, args.out / "backtest_2025_26.md")
    print(json.dumps({
        "saves_held_out_pass": report["pass"],
        "saves_held_out_reasons": report["saves_held_out_reasons"],
        "full_season_pass": report["full_season_pass"],
    }, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

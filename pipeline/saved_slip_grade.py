"""Grade saved slips from the same stat sources the day graders use.

KBO reads pitcher_logs.json and KBO_daily_batting_stats_combined.csv, including
postponed and off-slate voids. NFL reads nflverse weekly stats and the schedule.
WNBA reads the repo box scores. NHL reads the NHL API and only final games.

A scratched, OUT, DNP, or voided leg is a push. The slip result is computed
on the legs that remain: all void is a push, and a mix of hits and misses is
a partial. A leg whose game is not final stays pending.
"""
from __future__ import annotations

import re
from dataclasses import dataclass, field
from datetime import date

from pipeline.memory.common import (
    RESULT_DNP,
    RESULT_MISSING,
    RESULT_PUSH,
    RESULT_UNDER,
    RESULT_VOID,
    format_iso,
    grade_line,
    matchup_pair,
    name_match_key,
    normalize_name,
    parse_date,
    team_key,
)
from pipeline.memory.grade_kbo_day import STAT_KEY as KBO_STAT_KEY
from pipeline.memory.grade_nfl_day import actual_for_stat
from pipeline.memory.grade_nfl_day import name_key as nfl_name_key
from pipeline.memory.grade_nhl_day import STAT_KEYS as NHL_STAT_KEYS
from pipeline.memory.grade_nhl_day import _lookup_player, name_key as nhl_name_key
from pipeline.memory.grade_wnba_day import STAT_VALUE as WNBA_STAT_VALUE
from pipeline.memory import cutoff
from pipeline.saved_slip_sport import catalog, infer_slip_sport, legs_of

GRADED_SPORTS = tuple(catalog()["GRADED_SPORTS"])
OUT_TOKENS = {"out", "dnp", "scratched", "scratch", "inactive", "void"}
NFL_ALIAS = {"JAC": "JAX", "LA": "LAR", "WSH": "WAS"}
FETCH_LIMIT = 200


def _graded_sports() -> set[str]:
    return set(GRADED_SPORTS)


@dataclass
class DayUnavailable:
    sport: str
    reason: str


@dataclass
class KboDay:
    actuals: dict
    postponed: set = field(default_factory=set)
    scheduled: set | None = None


@dataclass
class NflDay:
    actuals: dict
    scheduled: set[str] | None = None
    finals: set[str] | None = None


@dataclass
class WnbaDay:
    box: dict


@dataclass
class NhlDay:
    actuals: dict


def ruled_out(leg: dict) -> bool:
    for key in ("status", "injury", "ppStatus", "pp_status", "board_status"):
        text = str(leg.get(key) or "").strip().lower()
        if not text:
            continue
        tokens = set(re.findall(r"[a-z]+", text))
        if tokens & OUT_TOKENS:
            return True
    return False


def _side(leg: dict) -> str:
    raw = str(leg.get("side") or "OVER").strip().upper()
    return "UNDER" if raw in {"UNDER", "LESS"} else "OVER"


def _stamp(leg: dict, result: str, actual=None, void_reason: str = "", ungradeable: bool = False) -> dict:
    out = dict(leg)
    out["result"] = result
    out["actual"] = actual
    if ungradeable:
        out["ungradeable"] = True
    else:
        out.pop("ungradeable", None)
    if void_reason:
        out["void_reason"] = void_reason
    else:
        out.pop("void_reason", None)
    return out


def _void(leg: dict, reason: str) -> dict:
    return _stamp(leg, "push", None, void_reason=reason)


def _pending(leg: dict) -> dict:
    return _stamp(leg, "pending", None)


def _blocked(leg: dict, reason: str) -> dict:
    return _stamp(leg, "pending", None, void_reason=reason, ungradeable=True)


def _mapped(table: dict, leg: dict):
    folded = {str(key).casefold(): value for key, value in table.items()}
    for candidate in (leg.get("prop"), leg.get("propShort"), leg.get("prop_short")):
        if candidate in table:
            return table[candidate]
        hit = folded.get(str(candidate or "").casefold())
        if hit:
            return hit
    return None


def _settle(leg: dict, outcome: str, actual) -> dict:
    if outcome in {RESULT_DNP, RESULT_VOID, RESULT_MISSING}:
        return _void(leg, outcome.lower())
    if outcome == RESULT_PUSH:
        return _stamp(leg, "push", actual, void_reason="push")
    side = _side(leg)
    if side == "UNDER":
        result = "hit" if outcome == RESULT_UNDER else "miss"
    else:
        result = "miss" if outcome == RESULT_UNDER else "hit"
    return _stamp(leg, result, actual)


def _grade_value(leg: dict, actual, line) -> dict:
    try:
        outcome = grade_line(actual, line)
    except (TypeError, ValueError):
        return _blocked(leg, "bad_line")
    return _settle(leg, outcome, actual)


def _expand_lookup(lookup: dict) -> dict:
    out = dict(lookup or {})
    for key, row in list((lookup or {}).items()):
        if not isinstance(key, tuple) or len(key) != 2 or not isinstance(row, dict):
            continue
        iso, _alias = key
        name = row.get("player") or row.get("name") or ""
        if not name:
            continue
        for alias in (name_match_key(name), normalize_name(name), nfl_name_key(name)):
            if alias:
                out[(iso, alias)] = row
    return out


def _find_row(lookup: dict, iso: str, name: str):
    for alias in (nfl_name_key(name), name_match_key(name), normalize_name(name)):
        if not alias:
            continue
        row = lookup.get((iso, alias))
        if row:
            return row
    return None


def _kbo_teams_done(actuals: dict, iso: str, legs: list[dict]) -> set[str]:
    slate_pairs = {
        pair
        for leg in legs
        if (pair := matchup_pair(leg.get("team"), leg.get("opponent")))
    }
    done: set[str] = set()
    for (day, _), row in (actuals or {}).items():
        if day != iso or not isinstance(row, dict) or not row.get("team"):
            continue
        pair = matchup_pair(row.get("team"), row.get("opponent"))
        if pair and pair in slate_pairs:
            done.add(team_key(row.get("team")))
    return done


def grade_kbo_legs(legs: list[dict], game_date: date, day: KboDay) -> list[dict]:
    iso = format_iso(game_date)
    actuals = _expand_lookup(day.actuals)
    done = _kbo_teams_done(actuals, iso, legs)
    graded = []
    for leg in legs:
        if ruled_out(leg):
            graded.append(_void(leg, "out"))
            continue
        pair = matchup_pair(leg.get("team"), leg.get("opponent"))
        if pair and pair in (day.postponed or set()):
            graded.append(_void(leg, "postponed"))
            continue
        if day.scheduled is not None and pair is not None and pair not in day.scheduled:
            graded.append(_void(leg, "not_on_slate"))
            continue
        stats = _find_row(actuals, iso, leg.get("name") or "")
        if not stats:
            prop_team = team_key(leg.get("team") or "")
            graded.append(_void(leg, "dnp") if prop_team and prop_team in done else _pending(leg))
            continue
        stat_key = _mapped(KBO_STAT_KEY, leg)
        if not stat_key:
            graded.append(_blocked(leg, "unmapped_prop"))
            continue
        actual = stats.get(stat_key)
        if actual is None:
            graded.append(_blocked(leg, "stat_missing"))
            continue
        graded.append(_grade_value(leg, actual, leg.get("line")))
    return graded


def _nfl_forms(team: str) -> set[str]:
    raw = str(team or "").strip().upper()
    if not raw:
        return set()
    return {raw, NFL_ALIAS.get(raw, raw)}


def _team_in(team: str, teams: set[str] | None) -> bool:
    if not teams:
        return False
    return bool(_nfl_forms(team) & teams)


def grade_nfl_legs(legs: list[dict], game_date: date, day: NflDay) -> list[dict]:
    iso = format_iso(game_date)
    actuals = _expand_lookup(day.actuals)
    graded = []
    for leg in legs:
        if ruled_out(leg):
            graded.append(_void(leg, "out"))
            continue
        stats = _find_row(actuals, iso, leg.get("name") or "")
        if stats:
            actual = actual_for_stat(stats, str(leg.get("prop") or leg.get("propShort") or ""))
            if actual is None:
                graded.append(_blocked(leg, "unmapped_prop"))
            else:
                graded.append(_grade_value(leg, actual, leg.get("line")))
            continue
        team = str(leg.get("team") or "")
        if day.finals is None or day.scheduled is None:
            graded.append(_pending(leg))
            continue
        if _team_in(team, day.scheduled) and not _team_in(team, day.finals):
            graded.append(_pending(leg))
            continue
        if _team_in(team, day.finals):
            graded.append(_void(leg, "dnp"))
            continue
        if team and day.scheduled is not None and not _team_in(team, day.scheduled):
            graded.append(_void(leg, "not_on_slate"))
            continue
        graded.append(_pending(leg))
    return graded


def _wnba_teams_done(box: dict, iso: str) -> set[str]:
    done = set()
    for (day, _), row in (box or {}).items():
        if day != iso or not isinstance(row, dict) or not row.get("team"):
            continue
        done.add(cutoff.wnba_team(row.get("team")))
    return done


def grade_wnba_legs(legs: list[dict], game_date: date, day: WnbaDay) -> list[dict]:
    iso = format_iso(game_date)
    box = _expand_lookup(day.box)
    done = _wnba_teams_done(box, iso)
    graded = []
    for leg in legs:
        if ruled_out(leg):
            graded.append(_void(leg, "out"))
            continue
        stats = _find_row(box, iso, leg.get("name") or "")
        if not stats:
            team = cutoff.wnba_team(leg.get("team") or "")
            graded.append(_void(leg, "dnp") if team and team in done else _pending(leg))
            continue
        stat_key = _mapped(WNBA_STAT_VALUE, leg)
        if not stat_key:
            graded.append(_blocked(leg, "unmapped_prop"))
            continue
        graded.append(_grade_value(leg, stats.get(stat_key), leg.get("line")))
    return graded


def _expand_nhl(players: dict) -> dict:
    out = dict(players or {})
    for key, row in list((players or {}).items()):
        if not isinstance(key, tuple) or len(key) != 2 or key[0] == "id" or not isinstance(row, dict):
            continue
        name = row.get("name") or ""
        if not name:
            continue
        out[(key[0], name_match_key(name))] = row
        out[(key[0], nhl_name_key(name))] = row
    return out


def grade_nhl_legs(legs: list[dict], day: NhlDay) -> list[dict]:
    from nhl.teams import team_abbr

    final_teams = set(day.actuals.get("final_teams") or [])
    players = _expand_nhl(day.actuals.get("players") or {})
    graded = []
    for leg in legs:
        if ruled_out(leg):
            graded.append(_void(leg, "out"))
            continue
        team = team_abbr(leg.get("team"))
        if team not in final_teams:
            graded.append(_pending(leg))
            continue
        prop = {
            "player": leg.get("name"),
            "playerId": leg.get("player_id") or leg.get("playerId"),
            "player_id": leg.get("player_id") or leg.get("playerId"),
        }
        stats = _lookup_player(players, team, prop) or players.get((team, name_match_key(leg.get("name"))))
        if not stats:
            graded.append(_void(leg, "missing"))
            continue
        if stats.get("played") is False:
            graded.append(_void(leg, "dnp"))
            continue
        stat_key = _mapped(NHL_STAT_KEYS, leg)
        if not stat_key or stats.get(stat_key) is None:
            graded.append(_blocked(leg, "unmapped_prop"))
            continue
        graded.append(_grade_value(leg, stats.get(stat_key), leg.get("line")))
    return graded


def _summarize(legs: list[dict]) -> dict:
    hits = misses = pushes = pending = blocked = 0
    for leg in legs:
        if leg.get("ungradeable"):
            blocked += 1
            continue
        result = leg.get("result") or "pending"
        if result == "hit":
            hits += 1
        elif result == "miss":
            misses += 1
        elif result == "push":
            pushes += 1
        else:
            pending += 1
    if pending:
        overall, graded = "pending", False
    elif blocked:
        overall, graded = "pending", False
    elif hits == 0 and misses == 0:
        overall, graded = "push", True
    elif misses == 0:
        overall, graded = "hit", True
    elif hits == 0:
        overall, graded = "miss", True
    else:
        overall, graded = "partial", True
    return {
        "legs": legs,
        "result": overall,
        "hits": hits,
        "misses": misses,
        "pushes": pushes,
        "graded": graded,
        "pending_legs": pending > 0,
        "ungradeable": blocked > 0 and pending == 0,
    }


def grade_slip(slip: dict, sources) -> dict:
    sport = infer_slip_sport(slip)
    legs = [leg if isinstance(leg, dict) else {} for leg in legs_of(slip)]
    game_date = parse_date(slip.get("game_date"))
    if sport not in _graded_sports():
        summary = _summarize([_blocked(leg, "no_grader") for leg in legs])
        summary["sport"] = sport or "unknown"
        summary["source_error"] = False
        summary["ungradeable"] = True
        summary["result"] = "pending"
        summary["graded"] = False
        return summary
    if game_date is None:
        summary = _summarize([_blocked(leg, "bad_date") for leg in legs])
        summary["sport"] = sport
        summary["source_error"] = False
        summary["ungradeable"] = True
        return summary
    try:
        day = sources.for_sport(sport, game_date)
    except Exception as exc:  # a source failure leaves the slip pending for the next run
        day = DayUnavailable(sport, type(exc).__name__)
    if isinstance(day, DayUnavailable) or day is None:
        summary = _summarize([_pending(leg) for leg in legs])
        summary["sport"] = sport
        summary["source_error"] = True
        summary["ungradeable"] = False
        return summary
    if sport == "kbo":
        graded = grade_kbo_legs(legs, game_date, day)
    elif sport == "nfl":
        graded = grade_nfl_legs(legs, game_date, day)
    elif sport == "wnba":
        graded = grade_wnba_legs(legs, game_date, day)
    else:
        graded = grade_nhl_legs(legs, day)
    summary = _summarize(graded)
    summary["sport"] = sport
    summary["source_error"] = False
    return summary


def _actual_key(value):
    if value is None or value == "":
        return None
    try:
        number = float(value)
    except (TypeError, ValueError):
        return str(value)
    if number == int(number):
        return int(number)
    return round(number, 4)


def _leg_view(leg: dict):
    return (
        leg.get("result") or "pending",
        _actual_key(leg.get("actual")),
        bool(leg.get("ungradeable")),
        leg.get("void_reason") or "",
        leg.get("name") or "",
        leg.get("prop") or "",
        _actual_key(leg.get("line")),
        str(leg.get("side") or "").upper(),
    )


def _count(value) -> int:
    try:
        return int(value or 0)
    except (TypeError, ValueError):
        return 0


def same_grade(slip: dict, payload: dict) -> bool:
    before = [leg if isinstance(leg, dict) else {} for leg in legs_of(slip)]
    after = payload.get("legs") or []
    if len(before) != len(after):
        return False
    if any(_leg_view(left) != _leg_view(right) for left, right in zip(before, after)):
        return False
    return (
        (slip.get("result") or "pending") == payload.get("result")
        and bool(slip.get("graded")) == bool(payload.get("graded"))
        and _count(slip.get("hits")) == _count(payload.get("hits"))
        and _count(slip.get("misses")) == _count(payload.get("misses"))
        and _count(slip.get("pushes")) == _count(payload.get("pushes"))
    )


def grade_batch(slips: list[dict], sources, today: date) -> tuple[list[dict], dict]:
    """Grade slips in memory. Returns updates and a count summary. No ids are logged."""
    summary = {
        "considered": 0,
        "would_update": 0,
        "unchanged": 0,
        "pending": 0,
        "could_not_grade": 0,
        "graded": 0,
    }
    updates = []
    for slip in slips:
        summary["considered"] += 1
        game_date = parse_date(slip.get("game_date"))
        if game_date is None or game_date > today:
            summary["could_not_grade"] += 1
            continue
        graded = grade_slip(slip, sources)
        if graded.get("source_error"):
            summary["could_not_grade"] += 1
            continue
        if game_date == today and graded.get("pending_legs"):
            summary["pending"] += 1
            continue
        sport = graded.get("sport") or "unknown"
        summary[f"sport_{sport}"] = summary.get(f"sport_{sport}", 0) + 1
        if graded.get("ungradeable"):
            summary["could_not_grade"] += 1
        elif graded.get("result") == "pending":
            summary["pending"] += 1
        else:
            summary["graded"] += 1
            result = graded.get("result") or "pending"
            summary[f"result_{result}"] = summary.get(f"result_{result}", 0) + 1
        payload = {
            "legs": graded["legs"],
            "result": graded["result"],
            "hits": graded["hits"],
            "misses": graded["misses"],
            "pushes": graded["pushes"],
            "graded": graded["graded"],
        }
        if same_grade(slip, payload):
            summary["unchanged"] += 1
            continue
        summary["would_update"] += 1
        updates.append({"id": slip.get("id"), "payload": payload})
    return updates, summary


def format_summary(summary: dict, *, dry_run: bool = False) -> str:
    title = "saved slip grading dry-run" if dry_run else "saved slip grading"
    written = "would_update" if dry_run else "updated"
    lines = [
        (
            f"{title}: considered={summary.get('considered', 0)} "
            f"{written}={summary.get('would_update', 0)} "
            f"unchanged={summary.get('unchanged', 0)} "
            f"pending={summary.get('pending', 0)} "
            f"could_not_grade={summary.get('could_not_grade', 0)}"
        )
    ]
    sports = [f"{key[6:]}={value}" for key, value in sorted(summary.items()) if key.startswith("sport_")]
    results = [f"{key[7:]}={value}" for key, value in sorted(summary.items()) if key.startswith("result_")]
    if sports:
        lines.append("by_sport " + " ".join(sports))
    if results:
        lines.append("by_result " + " ".join(results))
    if summary.get("source_notes"):
        lines.append("sources " + " ".join(summary["source_notes"]))
    lines.append(f"could_not_grade={summary.get('could_not_grade', 0)}")
    return "\n".join(lines)


class LiveSources:
    """Lazy stat loads. Failures stay on the source and do not include slip rows."""

    def __init__(self):
        self.notes: list[str] = []
        self._kbo_actuals = None
        self._wnba_box = None
        self._nfl_games = None
        self._nfl_actuals: dict = {}
        self._nhl: dict = {}

    def for_sport(self, sport: str, game_date: date):
        try:
            if sport == "kbo":
                return self._kbo(game_date)
            if sport == "nfl":
                return self._nfl(game_date)
            if sport == "wnba":
                return self._wnba(game_date)
            if sport == "nhl":
                return self._nhl_day(game_date)
        except (Exception, SystemExit) as exc:  # noqa: BLE001 - one source must not abort the run
            self._note(sport, game_date, exc)
            return DayUnavailable(sport, type(exc).__name__)
        return DayUnavailable(sport, "unknown_sport")

    def _note(self, sport: str, game_date: date, exc: Exception) -> None:
        note = f"{sport}:{game_date.isoformat()}:{type(exc).__name__}"
        if note not in self.notes:
            self.notes.append(note)

    def _kbo(self, game_date: date) -> KboDay:
        from pipeline.memory.common import postponed_matchups, scheduled_matchups
        from pipeline.memory.grade_kbo_day import build_actuals

        if self._kbo_actuals is None:
            self._kbo_actuals = build_actuals()
        return KboDay(
            actuals=self._kbo_actuals,
            postponed=postponed_matchups("kbo", game_date),
            scheduled=scheduled_matchups("kbo", game_date),
        )

    def _wnba(self, game_date: date) -> WnbaDay:
        del game_date
        from pipeline.memory.grade_wnba_day import load_boxscores

        if self._wnba_box is None:
            self._wnba_box = load_boxscores()
        return WnbaDay(box=self._wnba_box)

    def _nfl(self, game_date: date) -> NflDay:
        from pipeline.memory.grade_nfl_day import load_actuals_for_date

        iso = format_iso(game_date)
        if iso not in self._nfl_actuals:
            lookup, _finalized = load_actuals_for_date(game_date)
            self._nfl_actuals[iso] = lookup
        scheduled, finals = nfl_teams_for_date(self._games(), game_date)
        return NflDay(actuals=self._nfl_actuals[iso], scheduled=scheduled, finals=finals)

    def _games(self):
        if self._nfl_games is None:
            import pandas as pd
            from pipeline.memory.grade_nfl_day import GAMES_URL

            frame = pd.read_csv(GAMES_URL, low_memory=False)
            self._nfl_games = frame.to_dict("records")
        return self._nfl_games

    def _nhl_day(self, game_date: date) -> NhlDay:
        iso = format_iso(game_date)
        if iso not in self._nhl:
            from pipeline.memory.grade_nhl_day import load_actuals

            self._nhl[iso] = load_actuals(game_date)
        return NhlDay(actuals=self._nhl[iso])


def nfl_teams_for_date(games, target: date) -> tuple[set[str], set[str]]:
    """Team codes scheduled that day, and the subset whose game has both scores."""
    scheduled: set[str] = set()
    finals: set[str] = set()
    for game in games or []:
        if parse_date(game.get("gameday")) != target:
            continue
        away = str(game.get("away_team") or "").upper()
        home = str(game.get("home_team") or "").upper()
        sides = [team for team in (away, home) if team]
        scored = _has_score(game.get("home_score")) and _has_score(game.get("away_score"))
        for team in sides:
            for form in _nfl_forms(team):
                scheduled.add(form)
                if scored:
                    finals.add(form)
    return scheduled, finals


def _has_score(value) -> bool:
    if value is None or value == "":
        return False
    try:
        float(value)
    except (TypeError, ValueError):
        return False
    return True


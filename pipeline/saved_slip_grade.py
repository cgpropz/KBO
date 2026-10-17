"""Grade saved slips from the same stat sources the day graders use.

KBO reads pitcher_logs.json and KBO_daily_batting_stats_combined.csv, including
postponed and off-slate voids. NFL reads nflverse weekly stats and the schedule.
WNBA reads the repo box scores. NHL reads the NHL API and only final games.

A scratched, OUT, DNP, or voided leg is a push. The slip result is computed
on the legs that remain: all void is a push, and a mix of hits and misses is
a partial. A leg whose game is not final stays pending.
"""
from __future__ import annotations

from dataclasses import dataclass, field
from datetime import date, datetime, timedelta, timezone

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
from pipeline.memory.grade_nfl_day import actual_for_stat, stat_is_nan
from pipeline.memory.grade_nfl_day import name_key as nfl_name_key
from pipeline.memory.grade_nhl_day import STAT_KEYS as NHL_STAT_KEYS
from pipeline.memory.grade_nhl_day import _lookup_player, name_key as nhl_name_key
from pipeline.memory.grade_wnba_day import STAT_VALUE as WNBA_STAT_VALUE
from pipeline.memory import cutoff
from pipeline.saved_slip_sport import catalog, infer_slip_sport, legs_of

GRADED_SPORTS = tuple(catalog()["GRADED_SPORTS"])
OUT_TOKENS = {"out", "dnp", "scratched", "scratch", "inactive", "void", "removed", "pulled"}
STATUS_FIELDS = ("status", "ppStatus", "pp_status", "board_status")
MISSING_DATA_VOIDS = {"dnp", "missing", "not_on_slate", "stat_missing"}
NFL_ALIAS = {"JAC": "JAX", "LA": "LAR", "WSH": "WAS"}
FETCH_LIMIT = 200
DATE_WINDOW_DAYS = 7


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
    """Exact status values only. Free-text injury notes are not a void."""
    for key in STATUS_FIELDS:
        text = str(leg.get(key) or "").strip().lower()
        if text in OUT_TOKENS:
            return True
    return False


def et_calendar_date(value) -> date | None:
    """ET game date. A bare calendar day is kept. A timestamp is converted to ET."""
    if isinstance(value, datetime):
        parsed = value
    elif isinstance(value, date):
        return value
    else:
        raw = str(value or "").strip()
        if not raw:
            return None
        if len(raw) >= 10 and raw[4:5] == "-" and raw[7:8] == "-" and "T" not in raw and ":" not in raw:
            try:
                return date.fromisoformat(raw[:10])
            except ValueError:
                return None
        if "T" not in raw and ":" not in raw:
            return parse_date(raw)
        try:
            parsed = datetime.fromisoformat(raw.replace("Z", "+00:00"))
        except ValueError:
            return None
    if parsed.tzinfo is None:
        return parsed.date()
    try:
        from zoneinfo import ZoneInfo

        return parsed.astimezone(ZoneInfo("America/New_York")).date()
    except Exception:
        return parsed.astimezone(timezone(timedelta(hours=-4))).date()


def explicit_leg_date(leg: dict) -> date | None:
    """The leg's own ET game date, from start_time, then gameday, then game_date."""
    for key in ("start_time", "startTime", "start_time_utc"):
        found = et_calendar_date(leg.get(key))
        if found:
            return found
    for key in ("gameday", "gameDate", "game_date"):
        found = et_calendar_date(leg.get(key))
        if found:
            return found
    return None


def nearest_date(candidates, anchor: date, window: int = DATE_WINDOW_DAYS) -> date | None:
    """Earliest game on or after the slip date, within `window` days.

    A final from earlier in the week is not this slip's game. If nothing
    on or after the slip date is known yet, the leg stays pending.
    """
    best = None
    for when in candidates:
        if not isinstance(when, date):
            continue
        ahead = (when - anchor).days
        if ahead < 0 or ahead > window:
            continue
        if best is None or when < best:
            best = when
    return best


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
        number = float(actual)
    except (TypeError, ValueError):
        return _blocked(leg, "bad_line")
    if number != number:
        return _pending(leg)
    try:
        outcome = grade_line(number, line)
    except (TypeError, ValueError):
        return _blocked(leg, "bad_line")
    return _settle(leg, outcome, number)


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


def _teams_agree(sport: str, leg_team, row_team) -> bool:
    """When both sides name a team, the lookup has to be that team."""
    left = str(leg_team or "").strip()
    right = str(row_team or "").strip()
    if not left or not right:
        return True
    if sport == "nfl":
        return bool(_nfl_forms(left) & _nfl_forms(right))
    if sport == "wnba":
        return cutoff.wnba_team(left) == cutoff.wnba_team(right)
    if sport == "nhl":
        from nhl.teams import team_abbr

        return team_abbr(left) == team_abbr(right)
    return team_key(left) == team_key(right)


def _find_row(lookup: dict, iso: str, name: str, team: str = "", sport: str = ""):
    for alias in (nfl_name_key(name), name_match_key(name), normalize_name(name)):
        if not alias:
            continue
        row = lookup.get((iso, alias))
        if row and _teams_agree(sport, team, row.get("team")):
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
        pair = matchup_pair(leg.get("team"), leg.get("opponent"))
        if pair and pair in (day.postponed or set()):
            graded.append(_void(leg, "postponed"))
            continue
        if day.scheduled is not None and pair is not None and pair not in day.scheduled:
            graded.append(_void(leg, "not_on_slate"))
            continue
        stats = _find_row(actuals, iso, leg.get("name") or "", leg.get("team") or "", "kbo")
        if stats:
            stat_key = _mapped(KBO_STAT_KEY, leg)
            if not stat_key:
                graded.append(_blocked(leg, "unmapped_prop"))
                continue
            actual = stats.get(stat_key)
            if actual is None:
                graded.append(_pending(leg))
                continue
            graded.append(_grade_value(leg, actual, leg.get("line")))
            continue
        if ruled_out(leg):
            graded.append(_void(leg, "out"))
            continue
        prop_team = team_key(leg.get("team") or "")
        graded.append(_void(leg, "dnp") if prop_team and prop_team in done else _pending(leg))
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
        prop = str(leg.get("prop") or leg.get("propShort") or "")
        stats = _find_row(actuals, iso, leg.get("name") or "", leg.get("team") or "", "nfl")
        if stats:
            if stat_is_nan(stats, prop):
                graded.append(_pending(leg))
                continue
            actual = actual_for_stat(stats, prop)
            if actual is None:
                graded.append(_blocked(leg, "unmapped_prop"))
            else:
                graded.append(_grade_value(leg, actual, leg.get("line")))
            continue
        if ruled_out(leg):
            graded.append(_void(leg, "out"))
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
        # A slip saved on Saturday is not evidence the Sunday game was off the slate.
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
        stats = _find_row(box, iso, leg.get("name") or "", leg.get("team") or "", "wnba")
        if stats:
            stat_key = _mapped(WNBA_STAT_VALUE, leg)
            if not stat_key:
                graded.append(_blocked(leg, "unmapped_prop"))
                continue
            graded.append(_grade_value(leg, stats.get(stat_key), leg.get("line")))
            continue
        if ruled_out(leg):
            graded.append(_void(leg, "out"))
            continue
        team = cutoff.wnba_team(leg.get("team") or "")
        graded.append(_void(leg, "dnp") if team and team in done else _pending(leg))
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
        team = team_abbr(leg.get("team"))
        if team not in final_teams:
            graded.append(_pending(leg))
            continue
        prop = {
            "player": leg.get("name"),
            "playerId": leg.get("player_id") or leg.get("playerId"),
            "player_id": leg.get("player_id") or leg.get("playerId"),
        }
        by_id = None
        if prop.get("playerId") or prop.get("player_id"):
            by_id = _lookup_player(players, team, prop)
            if by_id and not _teams_agree("nhl", leg.get("team"), by_id.get("team")):
                by_id = None
        named = players.get((team, name_match_key(leg.get("name")))) or players.get((team, nhl_name_key(leg.get("name") or "")))
        if named and not _teams_agree("nhl", leg.get("team"), named.get("team")):
            named = None
        stats = by_id or named
        if stats:
            if stats.get("played") is False:
                graded.append(_void(leg, "dnp"))
                continue
            stat_key = _mapped(NHL_STAT_KEYS, leg)
            if not stat_key or stats.get(stat_key) is None:
                graded.append(_blocked(leg, "unmapped_prop"))
                continue
            graded.append(_grade_value(leg, stats.get(stat_key), leg.get("line")))
            continue
        if ruled_out(leg):
            graded.append(_void(leg, "out"))
            continue
        graded.append(_void(leg, "missing"))
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


def _grade_group(sport: str, legs: list[dict], game_date: date, day) -> list[dict]:
    if sport == "kbo":
        return grade_kbo_legs(legs, game_date, day)
    if sport == "nfl":
        return grade_nfl_legs(legs, game_date, day)
    if sport == "wnba":
        return grade_wnba_legs(legs, game_date, day)
    return grade_nhl_legs(legs, day)


def _leg_date(leg: dict, sport: str, anchor: date | None, sources) -> date | None:
    found = explicit_leg_date(leg)
    if found:
        return found
    if anchor is None:
        return None
    # KBO slips were saved on the game date. Do not search backward or forward.
    if sport == "kbo":
        return anchor
    finder = getattr(sources, "team_game_date", None)
    if finder is None:
        return None
    return finder(sport, str(leg.get("team") or ""), anchor)


def grade_slip(slip: dict, sources) -> dict:
    sport = infer_slip_sport(slip)
    legs = [leg if isinstance(leg, dict) else {} for leg in legs_of(slip)]
    anchor = parse_date(slip.get("game_date"))
    if sport not in _graded_sports():
        summary = _summarize([_blocked(leg, "no_grader") for leg in legs])
        summary["sport"] = sport or "unknown"
        summary["source_error"] = False
        summary["ungradeable"] = True
        summary["result"] = "pending"
        summary["graded"] = False
        return summary
    if anchor is None and not any(explicit_leg_date(leg) for leg in legs):
        summary = _summarize([_blocked(leg, "bad_date") for leg in legs])
        summary["sport"] = sport
        summary["source_error"] = False
        summary["ungradeable"] = True
        return summary
    dated = [(leg, _leg_date(leg, sport, anchor, sources)) for leg in legs]
    days: dict[date, object] = {}
    source_error = False
    for _, when in dated:
        if when is None or when in days:
            continue
        try:
            day = sources.for_sport(sport, when)
        except Exception as exc:  # a source failure leaves the leg pending for the next run
            day = DayUnavailable(sport, type(exc).__name__)
        if isinstance(day, DayUnavailable) or day is None:
            source_error = True
        days[when] = day
    grouped: dict[date | None, list[tuple[int, dict]]] = {}
    for index, (leg, when) in enumerate(dated):
        grouped.setdefault(when, []).append((index, leg))
    results: list[dict | None] = [None] * len(dated)
    for when, pairs in grouped.items():
        group = [leg for _, leg in pairs]
        if when is None or isinstance(days.get(when), DayUnavailable) or days.get(when) is None:
            graded_group = [_pending(leg) for leg in group]
        else:
            graded_group = _grade_group(sport, group, when, days[when])
        for (index, _), graded_leg in zip(pairs, graded_group):
            results[index] = graded_leg
    summary = _summarize([leg for leg in results if leg is not None])
    summary["sport"] = sport
    summary["source_error"] = source_error and summary.get("pending_legs")
    if source_error and not summary.get("pending_legs"):
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


def _change_bucket(row: dict) -> str:
    if row.get("ungradeable") and not row.get("graded"):
        return "ungradeable"
    return row.get("result") or "pending"


def missing_data_void(payload: dict) -> bool:
    """A push that exists only because stats or a slate row were absent."""
    if payload.get("result") != "push":
        return False
    if _count(payload.get("hits")) or _count(payload.get("misses")):
        return False
    reasons = [
        str(leg.get("void_reason") or "")
        for leg in payload.get("legs") or []
        if (leg.get("result") or "") == "push"
    ]
    return bool(reasons) and all(reason in MISSING_DATA_VOIDS for reason in reasons)


def _missing_data_leg(leg: dict) -> bool:
    return (leg.get("result") or "") == "push" and str(leg.get("void_reason") or "") in MISSING_DATA_VOIDS


def downgrade_blocked(slip: dict, payload: dict) -> bool:
    """A graded slip must not fall back to pending, ungradeable, or a missing-data void.

    One leg flipping from hit or miss to a missing-data void is enough. The
    other legs staying decided does not make that void safe to write.
    """
    if not slip.get("graded"):
        return False
    if not payload.get("graded") or payload.get("ungradeable") or payload.get("result") == "pending":
        return True
    before = [leg if isinstance(leg, dict) else {} for leg in legs_of(slip)]
    after = [leg if isinstance(leg, dict) else {} for leg in (payload.get("legs") or [])]
    if len(before) == len(after):
        for old, new in zip(before, after):
            if (old.get("result") or "") in {"hit", "miss"} and _missing_data_leg(new):
                return True
    return missing_data_void(payload)


def grade_batch(slips: list[dict], sources, today: date) -> tuple[list[dict], dict]:
    """Grade slips in memory. Returns updates and a count summary. No ids are logged."""
    summary = {
        "considered": 0,
        "would_update": 0,
        "unchanged": 0,
        "pending": 0,
        "could_not_grade": 0,
        "graded": 0,
        "kept_graded": 0,
        "changes": {},
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
            "ungradeable": bool(graded.get("ungradeable")),
        }
        if downgrade_blocked(slip, payload):
            summary["kept_graded"] += 1
            continue
        if same_grade(slip, payload):
            summary["unchanged"] += 1
            continue
        summary["would_update"] += 1
        change = f"{slip.get('result') or 'pending'}→{_change_bucket(payload)}"
        summary["changes"][change] = summary["changes"].get(change, 0) + 1
        stored = {key: value for key, value in payload.items() if key != "ungradeable"}
        updates.append({"id": slip.get("id"), "payload": stored})
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
    changes = summary.get("changes") or {}
    if changes:
        lines.append("changes " + " ".join(f"{key}={value}" for key, value in sorted(changes.items())))
    if summary.get("kept_graded"):
        lines.append(f"kept_graded={summary['kept_graded']}")
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

    def team_game_date(self, sport: str, team: str, anchor: date) -> date | None:
        """Earliest game on or after the slip date, within 7 days. Never a previous final."""
        if not str(team or "").strip():
            return None
        try:
            if sport == "nfl":
                return nearest_date(self._nfl_team_dates(team, anchor), anchor)
            if sport == "wnba":
                return nearest_date(self._wnba_team_dates(team, anchor), anchor)
            if sport == "nhl":
                return nearest_date(self._nhl_team_dates(team, anchor), anchor)
        except (Exception, SystemExit) as exc:  # noqa: BLE001 - a lookup miss stays pending
            self._note(sport, anchor, exc)
        return None

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

    def _on_or_after(self, when: date | None, anchor: date) -> bool:
        if when is None:
            return False
        ahead = (when - anchor).days
        return 0 <= ahead <= DATE_WINDOW_DAYS

    def _nfl_team_dates(self, team: str, anchor: date) -> list[date]:
        found = []
        for game in self._games():
            when = parse_date(game.get("gameday"))
            if not self._on_or_after(when, anchor):
                continue
            sides = {str(game.get("away_team") or "").upper(), str(game.get("home_team") or "").upper()}
            sides.discard("")
            if _team_in(team, sides):
                found.append(when)
        return found

    def _wnba_team_dates(self, team: str, anchor: date) -> list[date]:
        if self._wnba_box is None:
            from pipeline.memory.grade_wnba_day import load_boxscores

            self._wnba_box = load_boxscores()
        want = cutoff.wnba_team(team)
        found = []
        for (iso, _), row in (self._wnba_box or {}).items():
            if not isinstance(row, dict) or cutoff.wnba_team(row.get("team")) != want:
                continue
            when = parse_date(iso)
            if self._on_or_after(when, anchor):
                found.append(when)
        return found

    def _nhl_team_dates(self, team: str, anchor: date) -> list[date]:
        from nhl.teams import team_abbr
        from pipeline.memory.grade_nhl_day import load_actuals

        want = team_abbr(team)
        found = []
        for offset in range(0, DATE_WINDOW_DAYS + 1):
            when = anchor + timedelta(days=offset)
            iso = format_iso(when)
            if iso not in self._nhl:
                try:
                    self._nhl[iso] = load_actuals(when)
                except (Exception, SystemExit) as exc:  # noqa: BLE001
                    self._note("nhl", when, exc)
                    self._nhl[iso] = {"final_teams": set(), "players": {}}
            if want in set((self._nhl.get(iso) or {}).get("final_teams") or []):
                found.append(when)
        return found

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


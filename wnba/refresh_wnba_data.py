#!/usr/bin/env python3
"""Refresh WNBA player gamelogs through the WNBA game API.

The stats.wnba.com gateway intermittently hangs on CI runners. This script uses
the WNBA game scoreboard and summary API instead, then writes the normalized
boxscore CSV consumed by the bundled Express backend.

Some completed games stay on the scoreboard after ESPN drops their site summary
(HTTP 404). Those box scores are read from the ESPN core API. A historical game
missing from both sources keeps the rows already stored for that date so one
scrubbed game cannot fail the refresh.

Usage:
    python wnba/refresh_wnba_data.py                # seasons 2025 + 2026
    python wnba/refresh_wnba_data.py --seasons 2026 # a single season
"""
from __future__ import annotations

import argparse
from collections import Counter
import json
import sys
import time
from concurrent.futures import ThreadPoolExecutor, as_completed
from datetime import datetime
from pathlib import Path
from zoneinfo import ZoneInfo

import pandas as pd
import requests

ROOT = Path(__file__).resolve().parent
BOX_SCORE_CSV = ROOT / "wnba_boxscores_2025_2026.csv"
# Playoff box scores. Kept out of BOX_SCORE_CSV so projection averages (and
# DvP) stay regular-season only. Read by the memory/shadow graders and merged
# (tagged postseason) into the published player game logs by wnba/backend.
POSTSEASON_BOX_SCORE_CSV = ROOT / "wnba_boxscores_postseason.csv"
POSITIONS_JSON = ROOT / "mappings" / "player_positions.json"
SCOREBOARD_URL = "https://site.api.espn.com/apis/site/v2/sports/basketball/wnba/scoreboard"
SUMMARY_URL = "https://site.api.espn.com/apis/site/v2/sports/basketball/wnba/summary"
# site.api.espn.com is the primary host. site.web.api.espn.com is a fallback
# when the primary host rejects the request. Box-score loads try both, then
# the core API when every site summary returns 404.
ESPN_API_ROOTS = (
    "https://site.api.espn.com/apis/site/v2/sports/basketball/wnba",
    "https://site.web.api.espn.com/apis/site/v2/sports/basketball/wnba",
)
CORE_API = "https://sports.core.api.espn.com/v2/sports/basketball/leagues/wnba"
# A handful of scrubbed historical games can be kept from the existing CSV.
# More than this means the live API is broadly down, and --strict should fail
# instead of republishing a stale file.
MAX_KEPT_GAMES = 5
POSTSEASON_SLUGS = {"post-season", "postseason", "playoffs"}
TEAMS_URL = "https://site.api.espn.com/apis/site/v2/sports/basketball/wnba/teams"
ROSTER_URL = "https://site.api.espn.com/apis/site/v2/sports/basketball/wnba/teams/{team_id}/roster"
DEFAULT_SEASONS = [2025, 2026]
OUTPUT_COLUMNS = [
    "Player", "Team", "Match Up", "Game Date", "Season", "W/L", "MIN", "PTS",
    "FGM", "FGA", "FG%", "3PM", "3PA", "3P%", "FTM", "FTA", "FT%", "OREB",
    "DREB", "REB", "AST", "STL", "BLK", "TOV", "PF", "+/-",
]


class WnbaNotFound(RuntimeError):
    """ESPN has no document for this URL (HTTP 404)."""


def fetch_json(url: str, params: dict[str, object], max_retries: int = 3) -> dict:
    for attempt in range(1, max_retries + 1):
        try:
            response = requests.get(url, params=params, timeout=30)
            # A missing game summary will not appear on retry. Fail immediately
            # so one scrubbed event does not burn the retry budget.
            if response.status_code == 404:
                raise WnbaNotFound(f"WNBA API returned 404: {response.url}")
            response.raise_for_status()
            return response.json()
        except WnbaNotFound:
            raise
        except requests.RequestException as exc:
            if attempt == max_retries:
                raise RuntimeError(f"WNBA API request failed: {url}") from exc
            print(f"  [retry] API request {attempt}/{max_retries}: {exc}")
            time.sleep(2 ** attempt)
    raise AssertionError("unreachable")


def parse_made_attempted(value: object) -> tuple[int, int]:
    try:
        made, attempted = str(value).split("-", maxsplit=1)
        return int(made), int(attempted)
    except (TypeError, ValueError):
        return 0, 0


def percentage(made: int, attempted: int) -> float:
    return round((made / attempted) * 100, 1) if attempted else 0.0


def eastern_game_date(event: dict) -> str:
    return (
        datetime.fromisoformat(event["date"].replace("Z", "+00:00"))
        .astimezone(ZoneInfo("America/New_York"))
        .strftime("%m/%d/%Y")
    )


def _https(url: str) -> str:
    if url.startswith("http://"):
        return "https://" + url[len("http://"):]
    return url


def _core_stat_map(payload: dict) -> dict[str, str]:
    values: dict[str, str] = {}
    for category in (payload.get("splits") or {}).get("categories") or []:
        for stat in category.get("stats") or []:
            name = stat.get("name")
            if name:
                values[str(name)] = str(stat.get("displayValue") or "")
    return values


def _stat_int(value: str) -> int:
    try:
        return int(float(value))
    except (TypeError, ValueError):
        return 0


def _minutes_played(value: str) -> bool:
    text = (value or "").strip()
    if not text or text.upper() == "DNP":
        return False
    if ":" in text:
        minutes, seconds = text.split(":", maxsplit=1)
        try:
            return int(minutes) > 0 or int(seconds) > 0
        except ValueError:
            return False
    try:
        return float(text) > 0
    except ValueError:
        return False


def fetch_espn(path: str, params: dict[str, object]) -> dict:
    """GET an ESPN WNBA endpoint, trying the fallback host if the primary fails."""
    errors: list[Exception] = []
    for root in ESPN_API_ROOTS:
        try:
            return fetch_json(f"{root}/{path.lstrip('/')}", params)
        except Exception as exc:  # noqa: BLE001 - try the next host
            errors.append(exc)
            print(f"  [espn] {root} failed: {exc}")
    raise errors[-1]


def event_to_rows(
    event: dict, season: int, *, summary_url: str = SUMMARY_URL
) -> tuple[list[dict], dict[str, str]]:
    competition = event["competitions"][0]
    teams = competition["competitors"]
    team_details = {
        entry["team"]["abbreviation"]: {
            "home_away": entry["homeAway"],
            "winner": entry.get("winner", False),
        }
        for entry in teams
    }
    summary = fetch_json(summary_url, {"event": event["id"]})
    game_date = eastern_game_date(event)
    rows = []
    positions: dict[str, str] = {}

    for team_boxscore in summary.get("boxscore", {}).get("players", []):
        team = team_boxscore.get("team", {}).get("abbreviation")
        details = team_details.get(team)
        if not details:
            continue
        opponent = next((abbr for abbr in team_details if abbr != team), "")
        matchup = f"{team} vs. {opponent}" if details["home_away"] == "home" else f"{team} @ {opponent}"
        win_loss = "W" if details["winner"] else "L"

        for group in team_boxscore.get("statistics", []):
            names = group.get("names", [])
            for athlete_entry in group.get("athletes", []):
                # ESPN marks some finished-game participants inactive despite a complete stat line.
                if athlete_entry.get("didNotPlay"):
                    continue
                values = dict(zip(names, athlete_entry.get("stats", [])))
                if not values.get("MIN"):
                    continue
                athlete = athlete_entry.get("athlete", {})
                name = athlete.get("displayName", "").strip()
                position = athlete.get("position", {}).get("name", "").strip()
                if name and position in {"Guard", "Forward", "Center"}:
                    positions[name] = position
                fgm, fga = parse_made_attempted(values.get("FG"))
                fg3m, fg3a = parse_made_attempted(values.get("3PT"))
                ftm, fta = parse_made_attempted(values.get("FT"))
                rows.append({
                    "Player": name, "Team": team,
                    "Match Up": matchup, "Game Date": game_date, "Season": season,
                    "W/L": win_loss, "MIN": values.get("MIN", 0), "PTS": values.get("PTS", 0),
                    "FGM": fgm, "FGA": fga, "FG%": percentage(fgm, fga),
                    "3PM": fg3m, "3PA": fg3a, "3P%": percentage(fg3m, fg3a),
                    "FTM": ftm, "FTA": fta, "FT%": percentage(ftm, fta),
                    "OREB": values.get("OREB", 0), "DREB": values.get("DREB", 0),
                    "REB": values.get("REB", 0), "AST": values.get("AST", 0),
                    "STL": values.get("STL", 0), "BLK": values.get("BLK", 0),
                    "TOV": values.get("TO", 0), "PF": values.get("PF", 0),
                    "+/-": values.get("+/-", 0),
                })
    return rows, positions


def _team_context(event: dict) -> tuple[dict[str, dict[str, object]], str]:
    competition = event["competitions"][0]
    team_details = {
        entry["team"]["abbreviation"]: {
            "home_away": entry["homeAway"],
            "winner": entry.get("winner", False),
            "id": entry["team"]["id"],
        }
        for entry in competition["competitors"]
    }
    return team_details, eastern_game_date(event)


def event_to_rows_from_core(event: dict, season: int) -> tuple[list[dict], dict[str, str]]:
    """Player rows from the ESPN core roster stats when the site summary 404s."""
    team_details, game_date = _team_context(event)
    competition_id = event["competitions"][0].get("id") or event["id"]
    rows: list[dict] = []
    positions: dict[str, str] = {}

    for team, details in team_details.items():
        opponent = next((abbr for abbr in team_details if abbr != team), "")
        matchup = f"{team} vs. {opponent}" if details["home_away"] == "home" else f"{team} @ {opponent}"
        win_loss = "W" if details["winner"] else "L"
        roster_url = (
            f"{CORE_API}/events/{event['id']}/competitions/{competition_id}"
            f"/competitors/{details['id']}/roster"
        )
        roster = fetch_json(roster_url, {})
        for athlete_entry in roster.get("entries") or []:
            if athlete_entry.get("didNotPlay"):
                continue
            stats_ref = (athlete_entry.get("statistics") or {}).get("$ref")
            athlete_ref = (athlete_entry.get("athlete") or {}).get("$ref")
            if not stats_ref or not athlete_ref:
                continue
            raw = _core_stat_map(fetch_json(_https(stats_ref), {}))
            minutes = raw.get("minutes", "")
            if not _minutes_played(minutes):
                continue
            athlete = fetch_json(_https(athlete_ref), {})
            name = str(athlete.get("displayName") or "").strip()
            if not name:
                continue
            position_info = athlete.get("position") or {}
            position = ""
            if isinstance(position_info, dict):
                position = str(position_info.get("displayName") or position_info.get("name") or "").strip()
            if position in {"Guard", "Forward", "Center"}:
                positions[name] = position
            fgm = _stat_int(raw.get("fieldGoalsMade", ""))
            fga = _stat_int(raw.get("fieldGoalsAttempted", ""))
            fg3m = _stat_int(raw.get("threePointFieldGoalsMade", ""))
            fg3a = _stat_int(raw.get("threePointFieldGoalsAttempted", ""))
            ftm = _stat_int(raw.get("freeThrowsMade", ""))
            fta = _stat_int(raw.get("freeThrowsAttempted", ""))
            rows.append({
                "Player": name, "Team": team,
                "Match Up": matchup, "Game Date": game_date, "Season": season,
                "W/L": win_loss, "MIN": minutes, "PTS": _stat_int(raw.get("points", "")),
                "FGM": fgm, "FGA": fga, "FG%": percentage(fgm, fga),
                "3PM": fg3m, "3PA": fg3a, "3P%": percentage(fg3m, fg3a),
                "FTM": ftm, "FTA": fta, "FT%": percentage(ftm, fta),
                "OREB": _stat_int(raw.get("offensiveRebounds", "")),
                "DREB": _stat_int(raw.get("defensiveRebounds", "")),
                "REB": _stat_int(raw.get("rebounds", "")),
                "AST": _stat_int(raw.get("assists", "")),
                "STL": _stat_int(raw.get("steals", "")),
                "BLK": _stat_int(raw.get("blocks", "")),
                "TOV": _stat_int(raw.get("turnovers", "")),
                "PF": _stat_int(raw.get("fouls", "")),
                "+/-": raw.get("plusMinus", "0"),
            })
    return rows, positions


def preserved_rows_for_event(event: dict, season: int, backup_csv: Path) -> list[dict]:
    """Rows already stored for this game, used when ESPN no longer serves it."""
    if not backup_csv.exists():
        return []
    abbreviations = {
        entry.get("team", {}).get("abbreviation")
        for entry in event.get("competitions", [{}])[0].get("competitors", [])
    }
    abbreviations.discard(None)
    abbreviations.discard("")
    if len(abbreviations) < 2:
        return []
    game_date = eastern_game_date(event)
    frame = pd.read_csv(backup_csv, dtype=str).fillna("")
    if not set(OUTPUT_COLUMNS).issubset(frame.columns):
        return []

    def matchup_has_both_teams(value: str) -> bool:
        tokens = set(value.replace("@", " ").replace("vs.", " ").replace("VS", " ").split())
        return abbreviations <= tokens

    kept = frame[
        (frame["Game Date"] == game_date)
        & (frame["Season"] == str(season))
        & frame["Team"].isin(abbreviations)
        & frame["Match Up"].map(matchup_has_both_teams)
    ]
    if kept.empty:
        return []
    return kept[OUTPUT_COLUMNS].to_dict("records")


def load_event_boxscore(
    event: dict, season: int, backup_csv: Path
) -> tuple[list[dict], dict[str, str], str]:
    """Box score for one event.

    Returns rows, positions, and a source tag: ``site``, ``core``, or ``kept``.
    Timeouts and non-404 HTTP errors still propagate. A 404 from every site
    host falls through to the core API, then to rows already on disk.
    """
    not_found: list[Exception] = []
    other: list[Exception] = []
    for root in ESPN_API_ROOTS:
        try:
            rows, positions = event_to_rows(event, season, summary_url=f"{root}/summary")
            return rows, positions, "site"
        except WnbaNotFound as exc:
            not_found.append(exc)
            print(f"  [summary] event {event.get('id')} 404 on {root}")
        except Exception as exc:  # noqa: BLE001 - try the other site host
            other.append(exc)
            print(f"  [summary] event {event.get('id')} failed on {root}: {exc}")
    if len(not_found) == len(ESPN_API_ROOTS):
        core_rows: list[dict] = []
        core_positions: dict[str, str] = {}
        try:
            core_rows, core_positions = event_to_rows_from_core(event, season)
        except Exception as exc:  # noqa: BLE001 - historical rows are the last resort
            print(f"  [core] event {event.get('id')} failed: {exc}")
        kept = preserved_rows_for_event(event, season, backup_csv)
        if core_rows and kept and len(core_rows) < max(8, len(kept) // 2):
            print(
                f"  [core] event {event.get('id')} returned {len(core_rows)} rows; "
                f"keeping {len(kept)} existing rows"
            )
            core_rows = []
        if core_rows:
            print(
                f"  [core] event {event.get('id')} {event.get('shortName')}: "
                f"{len(core_rows)} rows"
            )
            return core_rows, core_positions, "core"
        if kept:
            print(
                f"  [keep] event {event.get('id')} {event.get('shortName')}: "
                f"kept {len(kept)} existing rows"
            )
            return kept, {}, "kept"
        event_id = event.get("id")
        raise RuntimeError(f"WNBA box score missing for event {event_id}") from not_found[-1]
    if other:
        raise other[-1]
    raise not_found[-1]


def _collect_event_rows(
    events: list[dict], season: int, backup_csv: Path
) -> tuple[list[dict], dict[str, Counter[str]], int, int]:
    rows: list[dict] = []
    positions: dict[str, Counter[str]] = {}
    core_games = 0
    kept_games = 0
    if not events:
        return rows, positions, core_games, kept_games
    with ThreadPoolExecutor(max_workers=8) as executor:
        futures = [
            executor.submit(load_event_boxscore, event, season, backup_csv)
            for event in events
        ]
        for future in as_completed(futures):
            event_rows, event_positions, source = future.result()
            rows.extend(event_rows)
            for name, position in event_positions.items():
                positions.setdefault(name, Counter())[position] += 1
            if source == "core":
                core_games += 1
            elif source == "kept":
                kept_games += 1
    if kept_games > MAX_KEPT_GAMES:
        raise RuntimeError(
            f"{kept_games} WNBA games had no live box score; "
            "refusing to refresh from the old file"
        )
    if core_games:
        print(f"  Rebuilt {core_games} games from the ESPN core API")
    if kept_games:
        print(f"  Kept existing rows for {kept_games} games with no live box score")
    return rows, positions, core_games, kept_games


def fetch_player_gamelogs(
    season: int, official_teams: set[str]
) -> tuple[pd.DataFrame, dict[str, str]]:
    scoreboard = fetch_json(SCOREBOARD_URL, {"limit": 1000, "dates": season})
    events = [
        event for event in scoreboard.get("events", [])
        if event.get("season", {}).get("slug") == "regular-season"
        and event.get("status", {}).get("type", {}).get("completed")
        and {
            competitor.get("team", {}).get("abbreviation")
            for competitor in event.get("competitions", [{}])[0].get("competitors", [])
        }.issubset(official_teams)
    ]
    print(f"  Fetching {len(events)} completed regular-season games for {season}")
    rows, positions, _core_games, _kept_games = _collect_event_rows(
        events, season, BOX_SCORE_CSV
    )
    if not rows:
        raise RuntimeError(f"WNBA API returned no gamelog rows for {season}")
    return (
        pd.DataFrame(rows, columns=OUTPUT_COLUMNS),
        {name: counts.most_common(1)[0][0] for name, counts in positions.items()},
    )


def fetch_postseason_gamelogs(seasons: list[int], official_teams: set[str]) -> pd.DataFrame:
    """Every completed postseason box score for ``seasons``. Not written into the regular-season CSV."""
    frames = []
    for season in seasons:
        scoreboard = fetch_espn("scoreboard", {"limit": 1000, "dates": season})
        events = [
            event for event in scoreboard.get("events", [])
            if event.get("season", {}).get("slug") in POSTSEASON_SLUGS
            and event.get("status", {}).get("type", {}).get("completed")
            and {
                competitor.get("team", {}).get("abbreviation")
                for competitor in event.get("competitions", [{}])[0].get("competitors", [])
            }.issubset(official_teams)
        ]
        print(f"  Fetching {len(events)} completed postseason games for {season}")
        rows, _positions, _core_games, _kept_games = _collect_event_rows(
            events, season, POSTSEASON_BOX_SCORE_CSV
        )
        if rows:
            frames.append(pd.DataFrame(rows, columns=OUTPUT_COLUMNS))
    if not frames:
        return pd.DataFrame(columns=OUTPUT_COLUMNS)
    combined = pd.concat(frames, ignore_index=True)
    combined["_sort"] = pd.to_datetime(combined["Game Date"], format="%m/%d/%Y", errors="coerce")
    return (
        combined.sort_values("_sort", ascending=False, na_position="last")
        .drop(columns=["_sort"])
        .reset_index(drop=True)
    )


def fetch_current_roster_positions() -> tuple[dict[str, str], set[str]]:
    league = fetch_json(TEAMS_URL, {"limit": 100})
    teams = league["sports"][0]["leagues"][0].get("teams", [])
    positions: dict[str, str] = {}
    for entry in teams:
        roster = fetch_json(ROSTER_URL.format(team_id=entry["team"]["id"]), {})
        for athlete in roster.get("athletes", []):
            name = athlete.get("displayName", "").strip()
            position = athlete.get("position", {}).get("name", "").strip()
            if name and position in {"Guard", "Forward", "Center"}:
                positions[name] = position
    if not positions:
        raise RuntimeError("WNBA roster API returned no player positions")
    return positions, {entry["team"]["abbreviation"] for entry in teams}


def refresh_gamelogs(seasons: list[int]) -> tuple[pd.DataFrame, dict[str, str]]:
    roster_positions, official_teams = fetch_current_roster_positions()
    results = [fetch_player_gamelogs(season, official_teams) for season in seasons]
    combined = pd.concat([result[0] for result in results], ignore_index=True)
    combined["_sort"] = pd.to_datetime(combined["Game Date"], format="%m/%d/%Y", errors="coerce")
    positions = {name: position for _, season_positions in results for name, position in season_positions.items()}
    # The active official roster supersedes historic listings after trades or position changes.
    positions.update(roster_positions)
    return (
        combined.sort_values("_sort", ascending=False, na_position="last").drop(columns=["_sort"]).reset_index(drop=True),
        positions,
    )


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Refresh WNBA gamelog data (requests-only).")
    parser.add_argument(
        "--seasons",
        nargs="+",
        type=int,
        default=DEFAULT_SEASONS,
        help="Seasons to fetch (default: 2025 2026).",
    )
    parser.add_argument(
        "--strict",
        action="store_true",
        help=(
            "Exit non-zero if the stats API is unreachable. Off by default so a CI "
            "run keeps the last committed gamelog CSV and the rest of the WNBA "
            "pipeline (projections + PrizePicks lines) still runs."
        ),
    )
    return parser.parse_args()


def main() -> int:
    args = parse_args()
    print(f"Refreshing WNBA gamelogs for seasons: {args.seasons}")

    try:
        gamelogs, positions = refresh_gamelogs(args.seasons)
    except Exception as exc:  # noqa: BLE001 - network block / API outage
        print(f"\n⚠ Gamelog refresh failed: {exc}")
        # Playoff box scores come from a separate fetch; refresh them anyway so
        # game logs still pick up new playoff games when the regular pull fails.
        _write_postseason_boxscores(args.seasons)
        if args.strict:
            return 1
        print(
            "  Keeping the existing committed boxscore CSV so the rest of "
            "the pipeline (projections + PrizePicks lines) still runs."
        )
        return 0

    if gamelogs.empty:
        print("✗ Stats API returned no rows; keeping the existing gamelog CSV.")
        _write_postseason_boxscores(args.seasons)
        return 1 if args.strict else 0

    newest = str(gamelogs.iloc[0]["Game Date"])

    gamelogs.to_csv(BOX_SCORE_CSV, index=False)
    POSITIONS_JSON.write_text(json.dumps(dict(sorted(positions.items())), indent=2) + "\n", encoding="utf-8")
    print(f"\n✅ Wrote {BOX_SCORE_CSV.name}: {len(gamelogs)} rows (newest game: {newest})")
    print(f"✅ Wrote {POSITIONS_JSON.name}: {len(positions)} official player positions")
    _write_postseason_boxscores(args.seasons)
    return 0


def _official_teams_for_postseason() -> set[str]:
    """Team abbreviations used to keep exhibition games out of the playoff file.

    The roster endpoint is the same source as the regular refresh. If that host
    is unreachable, fall back to abbreviations already in the regular-season
    CSV so a playoff fetch can still run without rewriting that file.
    """
    try:
        _roster, official_teams = fetch_current_roster_positions()
        if official_teams:
            return official_teams
    except Exception as exc:  # noqa: BLE001 - roster host can 403 while the scoreboard works
        print(f"  [postseason] roster lookup failed ({exc}); using regular-season team abbreviations")
    teams: set[str] = set()
    if BOX_SCORE_CSV.exists():
        import csv

        with BOX_SCORE_CSV.open(encoding="utf-8-sig", newline="") as handle:
            for row in csv.DictReader(handle):
                team = (row.get("Team") or "").strip()
                if team:
                    teams.add(team)
    return teams


def _write_postseason_boxscores(seasons: list[int]) -> None:
    """Write playoff box scores to a separate CSV. Failure must not roll back the regular file."""
    try:
        official_teams = _official_teams_for_postseason()
        if not official_teams:
            raise RuntimeError("no official team abbreviations for the postseason filter")
        postseason = fetch_postseason_gamelogs(seasons, official_teams)
    except Exception as exc:  # noqa: BLE001 - grading-only; keep the regular-season refresh
        print(f"\n⚠ Postseason box score refresh failed: {exc}")
        print(f"  Leaving {POSTSEASON_BOX_SCORE_CSV.name} unchanged.")
        return
    if postseason.empty:
        print(f"\n⚠ No completed postseason games; leaving {POSTSEASON_BOX_SCORE_CSV.name} unchanged.")
        return
    postseason.to_csv(POSTSEASON_BOX_SCORE_CSV, index=False)
    newest = str(postseason.iloc[0]["Game Date"])
    print(f"✅ Wrote {POSTSEASON_BOX_SCORE_CSV.name}: {len(postseason)} rows (newest game: {newest})")


if __name__ == "__main__":
    sys.exit(main())

#!/usr/bin/env python3
"""Build public/data/correlations_<sport>.json from today's board and game logs.

A missing board or a missing log fails this process. Refresh workflows run it
with continue-on-error so a failure does not block the rest of the deploy.

    python pipeline/build_correlations.py --sport kbo
    python pipeline/build_correlations.py --sport nhl --root /tmp/moneypuck
"""
from __future__ import annotations

import argparse
import sys
from pathlib import Path

REPO = Path(__file__).resolve().parents[1]
if str(REPO) not in sys.path:
    sys.path.insert(0, str(REPO))

from pipeline.correlations import (  # noqa: E402
    PUBLIC_DATA,
    correlate,
    kbo_logs_ready,
    kbo_props,
    load_basketball_logs,
    load_kbo_logs,
    load_nfl_log_rows,
    load_nhl_logs,
    nhl_props,
    nfl_props,
    basketball_props,
    write_document,
    _load_json,
)


def _require_props(sport: str, props) -> list:
    if not props:
        raise RuntimeError(f"{sport}: today's board has no props to correlate")
    return props


def build_kbo() -> dict:
    batter_csv = REPO / "Batters-Data" / "KBO_daily_batting_stats_combined.csv"
    pitcher_json = REPO / "Pitchers-Data" / "pitcher_logs.json"
    import csv
    with batter_csv.open(newline="", encoding="utf-8") as handle:
        batter_fields = csv.DictReader(handle).fieldnames
    pitcher_rows = _load_json(pitcher_json)
    if isinstance(pitcher_rows, dict):
        pitcher_rows = pitcher_rows.get("logs") or []
    pitcher_fields = list(pitcher_rows[0].keys()) if pitcher_rows else []
    if not kbo_logs_ready(batter_fields, pitcher_fields):
        raise RuntimeError("KBO logs are missing a game date or opponent key")
    props = _require_props("kbo", kbo_props(
        _load_json(PUBLIC_DATA / "batter_projections.json"),
        _load_json(PUBLIC_DATA / "strikeout_projections.json"),
    ))
    book, _found = load_kbo_logs(batter_csv, pitcher_json)
    return correlate("kbo", props, book)


def _read_board(path: Path):
    if not path.is_file():
        return None
    return _load_json(path)


def build_basketball(sport: str) -> dict:
    folder = PUBLIC_DATA / sport
    documents = []
    for name in ("projections_standard.json", "projections_demon.json", "projections_goblin.json"):
        payload = _read_board(folder / name)
        if payload is not None:
            documents.append(payload)
    if not documents:
        raise RuntimeError(f"{sport}: projection board is missing")
    props = _require_props(sport, basketball_props(documents))
    stats = {prop.stat for prop in props}
    if sport == "wnba":
        logs = [
            REPO / "wnba" / "wnba_boxscores_2025_2026.csv",
            REPO / "wnba" / "wnba_boxscores_postseason.csv",
        ]
    else:
        logs = [
            REPO / "nba" / "nba_boxscores_2025_26.csv",
            REPO / "nba" / "nba_boxscores_2026_27.csv",
        ]
    if not any(path.is_file() for path in logs):
        raise RuntimeError(f"{sport}: box score logs are missing")
    book = load_basketball_logs(logs, stats)
    return correlate(sport, props, book)


def _nfl_history():
    """Load nflverse weekly rows without requiring nfl/ to be a package."""
    import importlib.util
    path = REPO / "nfl" / "build_projection_data.py"
    spec = importlib.util.spec_from_file_location("cg_nfl_projection_data", path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module.load_history()


def build_nfl() -> dict:
    board_path = REPO / "nfl" / "projections.json"
    if not board_path.is_file():
        board_path = PUBLIC_DATA / "nfl" / "projections.json"
    props = _require_props("nfl", nfl_props(_load_json(board_path)))
    frame = _nfl_history()
    columns = [
        "player_display_name", "season", "week", "team", "opponent_team",
        "passing_yards", "attempts", "completions", "passing_tds",
        "rushing_yards", "carries", "receiving_yards", "receptions", "targets", "gameday",
    ]
    present = [column for column in columns if column in frame.columns]
    rows = frame[present].to_dict("records")
    for row in rows:
        if "gameday" in row and row.get("date") is None:
            row["date"] = row.get("gameday")
        row["player"] = row.get("player_display_name")
        row["opponent"] = row.get("opponent_team")
    book = load_nfl_log_rows(rows, {prop.stat for prop in props})
    return correlate("nfl", props, book)


def build_nhl(root: Path) -> dict:
    board_path = REPO / "nhl" / "projections.json"
    if not board_path.is_file():
        board_path = PUBLIC_DATA / "nhl" / "projections.json"
    props = _require_props("nhl", nhl_props(_load_json(board_path)))
    from nhl.history import load_goalies, load_skaters
    stats = {prop.stat for prop in props}
    skaters = load_skaters(root, ("2024", "2025", "2026")) if any(stat != "Goalie Saves" for stat in stats) else []
    goalies = load_goalies(root, ("2024", "2025", "2026")) if "Goalie Saves" in stats else []
    if not skaters and not goalies:
        raise RuntimeError(f"NHL MoneyPuck logs were not found under {root}")
    book = load_nhl_logs(skaters, goalies, stats)
    return correlate("nhl", props, book)


BUILDERS = {
    "kbo": build_kbo,
    "wnba": lambda: build_basketball("wnba"),
    "nba": lambda: build_basketball("nba"),
    "nfl": build_nfl,
}


def main(argv=None) -> int:
    parser = argparse.ArgumentParser(description="Build correlated prop pairs for one sport")
    parser.add_argument("--sport", required=True, choices=("kbo", "wnba", "nba", "nfl", "nhl"))
    parser.add_argument("--root", default="", help="MoneyPuck root for NHL")
    args = parser.parse_args(argv)
    try:
        if args.sport == "nhl":
            root = Path(args.root) if args.root else Path("/tmp/moneypuck")
            document = build_nhl(root)
        else:
            document = BUILDERS[args.sport]()
    except Exception as exc:  # noqa: BLE001 — the workflow treats any failure as skippable
        print(f"correlations {args.sport} failed: {exc}")
        return 1
    path = write_document(args.sport, document)
    print(f"correlations {args.sport}: {len(document['pairs'])} pairs -> {path}")
    return 0


if __name__ == "__main__":
    sys.exit(main())

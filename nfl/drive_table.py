"""Offensive drive, pace, and pass/rush EPA from nflverse play-by-play.

One row per team per game. Kneel-only series are not drives. The live card
downloads these files the same way it downloads the schedule. Past seasons
are cached on disk; the caller decides which seasons to refresh.
"""
from __future__ import annotations

import time
from pathlib import Path


PBP_URL = "https://github.com/nflverse/nflverse-data/releases/download/pbp/play_by_play_{season}.parquet"
CACHE_DIR = Path(__file__).resolve().parent / ".cache"
PBP_COLUMNS = (
    "game_id", "season_type", "posteam", "fixed_drive", "drive_time_of_possession",
    "play_type", "epa",
)


def _finite(value):
    if value is None:
        return None
    try:
        number = float(value)
    except (TypeError, ValueError):
        return None
    if number != number:
        return None
    return number


def parse_top(value):
    """nflverse prints time of possession as M:SS."""
    if not isinstance(value, str) or ":" not in value:
        return None
    minutes, seconds = value.split(":", 1)
    try:
        return int(minutes) * 60 + int(seconds)
    except ValueError:
        return None


def aggregate_plays(frame):
    """Team-game drive totals from a play-by-play frame.

    A drive counts when it has a pass, a run, or a field goal. Pure kneel
    series are dropped so the end of a blowout does not look like a fast pace.
    """
    import pandas as pd

    needed = [column for column in PBP_COLUMNS if column in frame.columns]
    missing = [column for column in ("game_id", "posteam", "fixed_drive", "play_type") if column not in needed]
    if missing:
        raise ValueError(f"play-by-play is missing {missing}")
    plays = frame.loc[
        frame["season_type"].eq("REG") & frame["posteam"].notna() & frame["fixed_drive"].notna(),
        list(needed),
    ].copy()
    if plays.empty:
        return pd.DataFrame(columns=["game_id", "team", "drives", "sec", "pass_n", "rush_n", "pass_epa", "rush_epa"])
    plays["sec"] = plays["drive_time_of_possession"].map(parse_top) if "drive_time_of_possession" in plays.columns else None
    plays["is_pass"] = plays["play_type"].eq("pass")
    plays["is_rush"] = plays["play_type"].eq("run")
    plays["is_fg"] = plays["play_type"].eq("field_goal")
    epa = plays["epa"] if "epa" in plays.columns else 0.0
    plays["pass_epa"] = epa.where(plays["is_pass"])
    plays["rush_epa"] = epa.where(plays["is_rush"])
    plays["pass_n"] = plays["is_pass"].astype(int)
    plays["rush_n"] = plays["is_rush"].astype(int)
    plays["fg_n"] = plays["is_fg"].astype(int)
    plays["sec_ok"] = plays["sec"].notna().astype(int)
    drives = plays.groupby(["game_id", "posteam", "fixed_drive"], sort=False).agg(
        sec=("sec", "max"),
        sec_ok=("sec_ok", "max"),
        pass_n=("pass_n", "sum"),
        rush_n=("rush_n", "sum"),
        fg_n=("fg_n", "sum"),
        pass_epa=("pass_epa", "sum"),
        rush_epa=("rush_epa", "sum"),
    )
    drives = drives[(drives["pass_n"] + drives["rush_n"] + drives["fg_n"]) > 0]
    if drives.empty:
        return pd.DataFrame(columns=["game_id", "team", "drives", "sec", "pass_n", "rush_n", "pass_epa", "rush_epa"])
    team = drives.groupby(["game_id", "posteam"], sort=False).agg(
        drives=("pass_n", "size"),
        sec=("sec", "sum"),
        sec_ok=("sec_ok", "sum"),
        pass_n=("pass_n", "sum"),
        rush_n=("rush_n", "sum"),
        pass_epa=("pass_epa", "sum"),
        rush_epa=("rush_epa", "sum"),
    ).reset_index()
    team = team.rename(columns={"posteam": "team"})
    incomplete = team["sec_ok"] < team["drives"]
    team.loc[incomplete, "sec"] = float("nan")
    return team[["game_id", "team", "drives", "sec", "pass_n", "rush_n", "pass_epa", "rush_epa"]]


def _download(url, dest, timeout=180):
    import requests

    dest.parent.mkdir(parents=True, exist_ok=True)
    temporary = dest.with_suffix(dest.suffix + ".part")
    with requests.get(url, timeout=timeout, stream=True) as response:
        response.raise_for_status()
        with temporary.open("wb") as handle:
            for chunk in response.iter_content(chunk_size=1 << 16):
                if chunk:
                    handle.write(chunk)
    temporary.replace(dest)


def _cache_path(cache_dir, season):
    return Path(cache_dir) / f"drives_{season}.csv"


def season_drive_table(season, cache_dir=CACHE_DIR, refresh=False):
    """Aggregate one season, reading a cached CSV unless refresh is set."""
    import pandas as pd

    cache = _cache_path(cache_dir, season)
    if cache.exists() and not refresh:
        return pd.read_csv(cache)
    parquet = Path(cache_dir) / f"play_by_play_{season}.parquet"
    if refresh or not parquet.exists():
        _download(PBP_URL.format(season=season), parquet)
    frame = pd.read_parquet(parquet, columns=list(PBP_COLUMNS))
    table = aggregate_plays(frame)
    cache.parent.mkdir(parents=True, exist_ok=True)
    table.to_csv(cache, index=False)
    return table


def load_drive_index(seasons, cache_dir=CACHE_DIR, refresh_seasons=(), canonical=None):
    """game_id -> team -> drive stats. `refresh_seasons` re-download those years."""
    import pandas as pd

    frames = []
    refresh = {int(season) for season in refresh_seasons}
    for season in seasons:
        frame = season_drive_table(int(season), cache_dir=cache_dir, refresh=int(season) in refresh)
        if frame is not None and len(frame):
            frames.append(frame)
    if not frames:
        return {}
    table = pd.concat(frames, ignore_index=True)
    index = {}
    for record in table.to_dict("records"):
        team = "" if record.get("team") is None else str(record["team"])
        if canonical is not None:
            team = canonical(team)
        drives = _finite(record.get("drives"))
        if drives is None or drives < 4:
            continue
        bucket = index.setdefault(str(record["game_id"]), {})
        bucket[team] = {
            "drives": drives,
            "sec": _finite(record.get("sec")),
            "pass_n": _finite(record.get("pass_n")) or 0.0,
            "rush_n": _finite(record.get("rush_n")) or 0.0,
            "pass_epa": _finite(record.get("pass_epa")) or 0.0,
            "rush_epa": _finite(record.get("rush_epa")) or 0.0,
        }
    return index


def attach_drives(games, index):
    """Copy drive stats onto schedule rows. Games with no table keep score-only updates."""
    attached = 0
    for game in games:
        game_id = game.get("game_id")
        by_team = index.get(str(game_id or ""))
        if not by_team:
            continue
        away = by_team.get(game.get("away_team"))
        home = by_team.get(game.get("home_team"))
        if not away or not home:
            continue
        for side, row in (("away", away), ("home", home)):
            game[f"{side}_drives"] = row["drives"]
            game[f"{side}_sec"] = row["sec"]
            game[f"{side}_pass_n"] = row["pass_n"]
            game[f"{side}_rush_n"] = row["rush_n"]
            game[f"{side}_pass_epa"] = row["pass_epa"]
            game[f"{side}_rush_epa"] = row["rush_epa"]
        attached += 1
    return attached


def cache_is_stale(season, cache_dir=CACHE_DIR, max_age_hours=12):
    cache = _cache_path(cache_dir, season)
    if not cache.exists():
        return True
    age = time.time() - cache.stat().st_mtime
    return age > max_age_hours * 3600

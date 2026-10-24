"""Public /status.json for the five prop boards.

Rewritten when a board is published. The file lists one entry per sport and
never includes prop rows. injuries_checked_at stays null unless the snapshot
itself carries an injury-check timestamp. None of the current lineup files do.

Stale windows match kbo-props-ui/src/boardFreshness.js.

NBA's 12h window is the full refresh (nba-refresh.yml at 6pm, 9pm, and 4am
ET). The 4am rebuild is not the hourly props job. Props stay inside
tip-5h..tip+3h and do not rebuild the board at 4am.
"""

from __future__ import annotations

import json
from datetime import datetime, timezone
from pathlib import Path
from typing import Any
from zoneinfo import ZoneInfo

from nhl.availability import REMOVED_REASONS, removed_reason_counts
from pipeline.snapshot_consistency import parse_iso_ts

ET = ZoneInfo("America/New_York")
SPORTS = ("kbo", "wnba", "nfl", "nba", "nhl")
STALE_AFTER_HOURS = {"kbo": 18, "wnba": 12, "nfl": 18, "nba": 12, "nhl": 12}
BOARD_TABLES = {
    "prizepicks_props": "kbo",
    "wnba_projections_standard": "wnba",
    "nfl_projections": "nfl",
    "nba_projections_standard": "nba",
    "nhl_projections": "nhl",
}
INJURY_KEYS = ("injuries_checked_at", "injury_checked_at", "lineups_checked_at")
ENTRY_KEYS = ("sport", "board_updated_at", "injuries_checked_at", "prop_count", "stale")
# Optional on an entry: why the last run did not publish. Set by a failed
# build step (e.g. nhl/fetch_history.py), cleared by the next publish.
FAILURE_REASONS = ("download_failed",)
# Optional on the KBO entry: PrizePicks returned 0 KBO props in the run that
# wrote it (pipeline/kbo_run_signal.py). prop_count is 0, the board clock is
# not moved forward, and the entry reads stale, so an empty board never shows
# a fresh stamp. The next publish with KBO props clears it.
NO_LINES_NOTE = "no_lines"


def copy_note(sport: str, value: Any) -> str | None:
    return NO_LINES_NOTE if sport == "kbo" and value == NO_LINES_NOTE else None


def copy_failure(value: Any) -> dict | None:
    """{reason, missing, at} with a known reason, or nothing."""
    if not isinstance(value, dict) or value.get("reason") not in FAILURE_REASONS:
        return None
    missing = value.get("missing")
    missing = [str(item) for item in missing if isinstance(item, str)] if isinstance(missing, list) else []
    return {"reason": value["reason"], "missing": missing[:200], "at": iso_with_et_offset(value.get("at"))}

REPO_ROOT = Path(__file__).resolve().parents[1]
STATUS_PATH = REPO_ROOT / "kbo-props-ui" / "public" / "status.json"


def prop_count(sport: str, data: Any) -> int:
    if sport == "kbo":
        cards = data.get("cards") if isinstance(data, dict) else None
        if not isinstance(cards, list):
            return 0
        total = 0
        for card in cards:
            props = card.get("props") if isinstance(card, dict) else None
            if isinstance(props, list):
                total += len(props)
        return total
    if sport in ("wnba", "nba"):
        if not isinstance(data, list):
            return 0
        total = 0
        for player in data:
            props = player.get("ppAllProps") if isinstance(player, dict) else None
            if isinstance(props, list):
                total += len(props)
        return total
    if sport in ("nfl", "nhl"):
        return len(data) if isinstance(data, list) else 0
    return 0


def injury_checked_at(data: Any) -> str | None:
    if not isinstance(data, dict):
        return None
    for key in INJURY_KEYS:
        parsed = parse_iso_ts(data.get(key))
        if parsed is not None:
            return parsed.astimezone(timezone.utc).isoformat()
    return None


def iso_with_et_offset(value: Any) -> str | None:
    parsed = parse_iso_ts(value)
    if parsed is None:
        return None
    return parsed.astimezone(ET).replace(microsecond=0).isoformat()


def is_stale(value: Any, sport: str, now: datetime) -> bool:
    parsed = parse_iso_ts(value)
    hours = STALE_AFTER_HOURS.get(sport)
    if parsed is None or not hours:
        return True
    if now.tzinfo is None:
        now = now.replace(tzinfo=timezone.utc)
    return (now - parsed).total_seconds() >= hours * 3600


def load_status(path: Path = STATUS_PATH) -> list[dict]:
    try:
        payload = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, ValueError, TypeError):
        return []
    rows = payload.get("boards") if isinstance(payload, dict) else None
    if not isinstance(rows, list):
        return []
    return [row for row in rows if isinstance(row, dict) and row.get("sport") in SPORTS]


def copy_removed_reasons(value: Any) -> dict[str, int] | None:
    """The five NHL labels, or nothing. Other sports do not carry this field."""
    if not isinstance(value, dict):
        return None
    counts = {}
    for reason in REMOVED_REASONS:
        raw = value.get(reason, 0)
        counts[reason] = raw if isinstance(raw, int) and not isinstance(raw, bool) and raw >= 0 else 0
    return counts


def merge_status(previous: list[dict], updates: dict[str, dict], now: datetime) -> dict:
    """One entry per sport. `updates` replaces only the sports just published."""
    prior = {row["sport"]: row for row in previous if isinstance(row, dict) and row.get("sport")}
    boards = []
    for sport in SPORTS:
        update = updates.get(sport)
        prev = prior.get(sport) or {}
        if update:
            raw = update.get("board_updated_at")
            injury = update.get("injuries_checked_at")
            count = update.get("prop_count")
            count = int(count) if isinstance(count, int) and not isinstance(count, bool) else 0
            reasons = copy_removed_reasons(update.get("removed_reasons"))
            # A publish clears the failure; prefer_fresher passes it through.
            failure = copy_failure(update.get("last_failure"))
            note = copy_note(sport, update.get("note"))
            if note is not None:
                # Nothing new to show: keep the last real publish clock.
                raw = prev.get("board_updated_at")
                count = 0
        else:
            raw = prev.get("board_updated_at")
            injury = prev.get("injuries_checked_at")
            count = prev.get("prop_count")
            count = int(count) if isinstance(count, int) and not isinstance(count, bool) else 0
            reasons = copy_removed_reasons(prev.get("removed_reasons"))
            failure = copy_failure(prev.get("last_failure"))
            note = copy_note(sport, prev.get("note"))
        entry = {
            "sport": sport,
            "board_updated_at": iso_with_et_offset(raw),
            "injuries_checked_at": iso_with_et_offset(injury),
            "prop_count": count,
            "stale": True if note is not None else is_stale(raw, sport, now),
        }
        if reasons is not None:
            entry["removed_reasons"] = reasons
        if note is not None:
            entry["note"] = note
        if failure is not None:
            entry["last_failure"] = failure
        boards.append(entry)
    return {"boards": boards}


def write_status(document: dict, path: Path = STATUS_PATH) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(document, indent=2) + "\n", encoding="utf-8")


# A publish clock further ahead of now than this is treated as missing, so a
# bad future-dated entry loses to a real publish and self-heals.
FUTURE_SKEW_SECONDS = 5 * 60


def _usable_clock(value: Any, now: datetime | None) -> datetime | None:
    parsed = parse_iso_ts(value)
    if parsed is None:
        return None
    if parsed.tzinfo is None:
        parsed = parsed.replace(tzinfo=timezone.utc)
    moment = now or datetime.now(timezone.utc)
    if moment.tzinfo is None:
        moment = moment.replace(tzinfo=timezone.utc)
    if (parsed - moment).total_seconds() > FUTURE_SKEW_SECONDS:
        return None
    return parsed


def _later_row(left: dict, right: dict, now: datetime | None = None) -> dict:
    """Keep the entry whose publish clock is later. A missing clock loses, and
    so does one more than five minutes in the future."""
    left_at = _usable_clock(left.get("board_updated_at"), now) if left else None
    right_at = _usable_clock(right.get("board_updated_at"), now) if right else None
    if left_at and right_at:
        return left if left_at >= right_at else right
    if left_at:
        return left
    if right_at:
        return right
    return right or left or {}


def prefer_fresher(local: list[dict], remote: list[dict], now: datetime) -> dict:
    """Per sport, keep the later publish. Used when two jobs write one file."""
    left = {row["sport"]: row for row in local if isinstance(row, dict) and row.get("sport")}
    right = {row["sport"]: row for row in remote if isinstance(row, dict) and row.get("sport")}
    updates = {}
    previous = []
    for sport in SPORTS:
        chosen = _later_row(left.get(sport) or {}, right.get(sport) or {}, now)
        count = chosen.get("prop_count")
        updates[sport] = {
            "board_updated_at": chosen.get("board_updated_at"),
            "injuries_checked_at": chosen.get("injuries_checked_at"),
            "prop_count": int(count) if isinstance(count, int) and not isinstance(count, bool) else 0,
        }
        reasons = copy_removed_reasons(chosen.get("removed_reasons"))
        if reasons is not None:
            updates[sport]["removed_reasons"] = reasons
        failure = copy_failure(chosen.get("last_failure"))
        if failure is not None:
            updates[sport]["last_failure"] = failure
        note = copy_note(sport, chosen.get("note"))
        previous.append({"sport": sport, "board_updated_at": chosen.get("board_updated_at")})
        if note is not None:
            updates[sport]["note"] = note
    return merge_status(previous, updates, now)


def record_failure(sport: str, reason: str, missing=None, now: datetime | None = None,
                   path: Path = STATUS_PATH) -> dict:
    """Mark why `sport` did not publish. The board clock and counts stay as they were.

    commit_status.sh (if: always()) then commits it, so Board QA's freshness
    check can say why the board is stale.
    """
    moment = now or datetime.now(timezone.utc)
    rows = load_status(path)
    prior = {row["sport"]: row for row in rows}
    updates = {}
    for name in SPORTS:
        row = dict(prior.get(name) or {})
        if name == sport:
            row["last_failure"] = {"reason": reason, "missing": list(missing or []), "at": moment.isoformat()}
        updates[name] = row
    # Keep each sport's own clock and counts: feed them as previous rows.
    document = merge_status([updates[name] | {"sport": name} for name in SPORTS], {}, moment)
    write_status(document, path)
    return document


def apply_published(updates: dict[str, dict], now: datetime | None = None, path: Path = STATUS_PATH) -> dict:
    moment = now or datetime.now(timezone.utc)
    document = merge_status(load_status(path), updates, moment)
    write_status(document, path)
    return document


def record_from_payload(sport: str, data: Any, published_at: str, env=None) -> dict:
    record = {
        "board_updated_at": published_at,
        "injuries_checked_at": injury_checked_at(data),
        "prop_count": prop_count(sport, data),
    }
    if sport == "nhl":
        record["removed_reasons"] = removed_reason_counts(data if isinstance(data, list) else [])
    if sport == "kbo" and record["prop_count"] == 0:
        from pipeline.kbo_run_signal import no_kbo_lines_this_run

        if no_kbo_lines_this_run(env):
            record["note"] = NO_LINES_NOTE
    return record

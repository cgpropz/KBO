"""Players who will not dress stay off the NHL board.

Lineup statuses (the nhl_lineups snapshot) are the source when that
snapshot lists someone OUT, IR, LTIR, or scratched. The public NHL web
API (api-web.nhle.com) is the source when the snapshot has none of those
statuses, and it also adds a scratch the snapshot missed. A failed API
read logs a warning. Lineup statuses still apply. With neither source,
the board stays as it is.
"""
from __future__ import annotations

import json
import logging
import re
import urllib.request

log = logging.getLogger(__name__)

RIGHT_RAIL_URL = "https://api-web.nhle.com/v1/gamecenter/{game_id}/right-rail"


def name_key(name: str | None) -> str:
    text = str(name or "").lower()
    text = re.sub(r"\s+(jr|sr|ii|iii|iv|v)\.?$", "", text.strip())
    return re.sub(r"[^a-z0-9]", "", text)


def blocked_status(value) -> str | None:
    """OUT, IR, LTIR, or scratched. Anything else stays on the board."""
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


def _person(value) -> str:
    if isinstance(value, dict):
        return str(value.get("default") or "").strip()
    return str(value or "").strip()


def _add_player(player, names: set[str], ids: set[str]) -> None:
    if not isinstance(player, dict):
        return
    raw_id = player.get("playerId")
    if raw_id is None:
        raw_id = player.get("id")
    if raw_id is not None and str(raw_id).strip().isdigit():
        ids.add(str(raw_id).strip())
    name = player.get("name") or player.get("player")
    if isinstance(name, dict):
        name = name.get("default")
    if not name:
        name = " ".join(part for part in (_person(player.get("firstName")), _person(player.get("lastName"))) if part)
    if name:
        names.add(name_key(name))


def lineups_unavailable(lineups) -> tuple[set[str], set[str], bool]:
    """Names and ids listed OUT, IR, LTIR, or scratched on the lineup snapshot.

    The third value is true when that snapshot already has one of those
    statuses. Goalie tags and game-time decisions are not that list.
    """
    names: set[str] = set()
    ids: set[str] = set()
    found = False
    for game in lineups or []:
        if not isinstance(game, dict):
            continue
        groups = []
        for bucket in (game.get("lineups"), game.get("injuries")):
            if isinstance(bucket, dict):
                groups.extend(players for players in bucket.values() if isinstance(players, list))
            elif isinstance(bucket, list):
                groups.append(bucket)
        for players in groups:
            for player in players:
                if not isinstance(player, dict):
                    continue
                if not blocked_status(player.get("status") or player.get("injury")):
                    continue
                found = True
                _add_player(player, names, ids)
    return names, ids, found


def parse_api_payload(payload) -> tuple[set[str], set[str]]:
    """Scratches, plus any player carrying an OUT, IR, LTIR, or scratched status."""
    names: set[str] = set()
    ids: set[str] = set()

    def walk(node) -> None:
        if isinstance(node, dict):
            scratches = node.get("scratches")
            if isinstance(scratches, list):
                for player in scratches:
                    _add_player(player, names, ids)
            if blocked_status(node.get("status") or node.get("injuryStatus") or node.get("injury")):
                _add_player(node, names, ids)
            for value in node.values():
                walk(value)
        elif isinstance(node, list):
            for item in node:
                walk(item)

    walk(payload)
    return names, ids


def _json(url: str, timeout: int = 40):
    request = urllib.request.Request(
        url,
        headers={"User-Agent": "CGPropz/1.0", "Accept": "application/json"},
    )
    with urllib.request.urlopen(request, timeout=timeout) as response:
        return json.loads(response.read().decode("utf-8"))


def fetch_api_unavailable(games, fetch_json=_json) -> tuple[set[str], set[str]]:
    """Read api-web.nhle.com for each game. Every game failing raises."""
    names: set[str] = set()
    ids: set[str] = set()
    errors = []
    attempts = 0
    for game in games or []:
        game_id = (game or {}).get("id")
        if not game_id:
            continue
        attempts += 1
        try:
            payload = fetch_json(RIGHT_RAIL_URL.format(game_id=game_id))
        except Exception as exc:  # noqa: BLE001 - one game must not wipe the night
            errors.append(f"{game_id}: {exc}")
            continue
        got_names, got_ids = parse_api_payload(payload)
        names.update(got_names)
        ids.update(got_ids)
    if attempts and len(errors) == attempts:
        raise RuntimeError("; ".join(errors))
    if errors:
        log.warning("NHL injury source missed some games: %s", "; ".join(errors))
    return names, ids


def unavailable_keys(lineups, games, fetch_json=_json) -> tuple[set[str], set[str]]:
    """Lineup statuses when that snapshot has them, otherwise the NHL API.

    A snapshot that already lists someone OUT, IR, LTIR, or scratched is the
    source for those players. The public API is the source when the snapshot
    has none of those statuses. It is also read when the snapshot does have
    them, so a scratch the sheet missed still comes off. If that read fails
    and the snapshot had statuses, those statuses still apply. If it fails
    and the snapshot had none, the caller keeps the board.
    """
    names, ids, has_status = lineups_unavailable(lineups)
    try:
        api_names, api_ids = fetch_api_unavailable(games, fetch_json)
    except Exception as exc:  # noqa: BLE001 - a dead feed must not wipe the board
        if has_status:
            log.warning("NHL injury source failed, using lineup statuses: %s", exc)
            return names, ids
        raise
    if has_status:
        return names | api_names, ids | api_ids
    return api_names, api_ids


def drop_unavailable(projections, lineups, games, fetch_json=_json) -> list:
    """Remove players who will not dress. A failed source returns the same rows."""
    rows = list(projections or [])
    try:
        names, ids = unavailable_keys(lineups, games, fetch_json)
    except Exception as exc:  # noqa: BLE001 - keep the board when the injury read fails
        log.warning("NHL injury source failed, keeping the board: %s", exc)
        return rows
    kept = []
    for row in rows:
        player_id = str(row.get("playerId") or "").strip()
        if player_id and player_id in ids:
            continue
        if name_key(row.get("player")) in names:
            continue
        kept.append(row)
    return kept


def finish_board(projections, lineups, games, fetch_json=_json) -> list:
    """Filter, then rank. The saved board and the free top 3 both use this list."""
    kept = drop_unavailable(projections, lineups, games, fetch_json=fetch_json)
    kept.sort(key=lambda row: (
        row.get("rankEligible") is False,
        -(row.get("score") or 0),
        row.get("player") or "",
        row.get("prop") or "",
    ))
    return kept

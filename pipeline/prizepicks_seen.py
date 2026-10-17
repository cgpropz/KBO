"""Remember PrizePicks projection ids across board builds.

The local projections file is gitignored and is not on a fresh GitHub
checkout. The copy that survives a workflow run is the published Supabase
snapshot (nhl_projections / nfl_projections, id = 1, data = the board).
"""
from __future__ import annotations

import json
import os
from datetime import datetime, timezone
from pathlib import Path
from urllib.parse import parse_qsl, urlencode, urljoin, urlparse, urlunparse
from zoneinfo import ZoneInfo

ET = ZoneInfo("America/New_York")
# A new fetch more than this much smaller than the last one is partial.
# Flagging that body would mark live lines removed.
FETCH_DROP_LIMIT = 0.30
PUBLISHED_BOARD_TABLES = {
    "nhl": "nhl_projections",
    "nfl": "nfl_projections",
}


def prizepicks_projection_ids(payload) -> list[str]:
    """Projection ids in a PrizePicks body. Empty when the body has none."""
    if not isinstance(payload, dict):
        return []
    data = payload.get("data")
    if not isinstance(data, list):
        return []
    ids = []
    for item in data:
        if not isinstance(item, dict) or item.get("id") is None:
            continue
        text = str(item.get("id")).strip()
        if text:
            ids.append(text)
    return ids


def prizepicks_fetch_is_usable(status, payload, error=None) -> bool:
    """False for a 403, any other error, or a body with no projection ids.

    An unusable fetch must not be treated as "every saved id disappeared."
    """
    if error is not None or status is None:
        return False
    try:
        code = int(status)
    except (TypeError, ValueError):
        return False
    if code >= 400:
        return False
    return bool(prizepicks_projection_ids(payload))


def projection_id_of(row) -> str:
    """PrizePicks projection id stored on a board row.

    A numeric id is the PrizePicks card id the NHL writer publishes.
    A player-prop slug is not.
    """
    if not isinstance(row, dict):
        return ""
    explicit = row.get("projection_id")
    if explicit is not None and not _missing(explicit):
        text = str(explicit).strip()
        if text and text.lower() != "nan":
            return text
    raw = row.get("id")
    text = "" if raw is None or _missing(raw) else str(raw).strip()
    return text if text.isdigit() else ""


def _missing(value) -> bool:
    return isinstance(value, float) and value != value


def fetch_shrunk(previous_count, new_count, limit=FETCH_DROP_LIMIT) -> bool:
    """True when the new id list is more than about 30% smaller."""
    try:
        previous = int(previous_count or 0)
        current = int(new_count or 0)
    except (TypeError, ValueError):
        return False
    if previous <= 0:
        return False
    return current < previous * (1 - limit)


def previous_fetch_count(rows) -> int:
    best = 0
    for row in rows or []:
        if not isinstance(row, dict):
            continue
        try:
            best = max(best, int(row.get("prizepicks_fetch_count") or 0))
        except (TypeError, ValueError):
            continue
    return best


def _aware(moment: datetime) -> datetime:
    if moment.tzinfo is None:
        return moment.replace(tzinfo=timezone.utc)
    return moment


def row_start(row) -> datetime | None:
    """Kickoff on a board row. Missing or unparseable clocks are not a start."""
    if not isinstance(row, dict):
        return None
    for key in ("start_time", "start_time_utc", "start"):
        text = str(row.get(key) or "").strip()
        if not text:
            continue
        try:
            moment = datetime.fromisoformat(text.replace("Z", "+00:00"))
        except ValueError:
            continue
        return _aware(moment)
    gameday = str(row.get("gameday") or row.get("game_date") or row.get("gameDate") or "").strip()
    gametime = str(row.get("gametime") or row.get("game_time") or "").strip()
    if len(gameday) < 10 or not gametime:
        return None
    parts = gametime.split(":")
    if len(parts) < 2:
        return None
    try:
        clock = f"{int(parts[0]):02d}:{int(parts[1]):02d}"
        if len(parts) > 2:
            clock = f"{clock}:{int(parts[2]):02d}"
        moment = datetime.fromisoformat(f"{gameday[:10]}T{clock}")
    except ValueError:
        return None
    return moment.replace(tzinfo=ET)


def start_in_future(row, now: datetime) -> bool:
    moment = row_start(row)
    if moment is None:
        return False
    return moment > _aware(now)


def slate_date(row) -> str:
    moment = row_start(row)
    if moment is not None:
        return moment.astimezone(ET).date().isoformat()
    text = str((row or {}).get("gameday") or (row or {}).get("game_date") or "").strip()
    return text[:10] if len(text) >= 10 else ""


def team_key(row) -> str:
    return str((row or {}).get("team") or "").strip().upper()


def _slate_dates(rows) -> set[str]:
    dates = set()
    for row in rows or []:
        day = slate_date(row)
        if day:
            dates.add(day)
    return dates


def flag_missing_seen_projections(
    previous,
    current,
    fetched_ids,
    *,
    fetch_ok,
    now=None,
    exclude_teams=None,
):
    """Keep a future projection a good fetch no longer returns.

    Started or finished games are never marked removed. Carried rows leave
    after their start, and they leave when their slate date is no longer on
    the board. A 403, an error, an empty id list, a missing previous fetch
    count, or a fetch more than about 30% smaller than the last one marks
    nothing. Rows restored for a team with no current logs (exclude_teams)
    are not flagged.
    """
    current_rows = [dict(row) for row in current or [] if isinstance(row, dict)]
    if not fetch_ok:
        return current_rows
    fetched = {str(item).strip() for item in fetched_ids or [] if str(item).strip()}
    if not fetched:
        return current_rows
    # No stored count means this is the first guarded run (or a board from
    # before the count existed). Do not treat every absent id as pulled.
    prior_count = previous_fetch_count(previous)
    if prior_count <= 0 or fetch_shrunk(prior_count, len(fetched)):
        _stamp_fetch_count(current_rows, len(fetched))
        return current_rows
    moment = now or datetime.now(timezone.utc)
    blocked = {str(team or "").strip().upper() for team in (exclude_teams or set()) if str(team or "").strip()}
    slate_dates = _slate_dates(current_rows)
    present = set()
    merged = []
    for row in current_rows:
        pid = projection_id_of(row)
        if (
            pid
            and pid not in fetched
            and team_key(row) not in blocked
            and start_in_future(row, moment)
        ):
            row["removed"] = True
            row["pp_status"] = "removed"
            row["projection_id"] = pid
        if pid:
            present.add(pid)
        merged.append(row)
    for prev in previous or []:
        if not isinstance(prev, dict):
            continue
        pid = projection_id_of(prev)
        if not pid or pid in fetched or pid in present:
            continue
        if team_key(prev) in blocked:
            continue
        if not start_in_future(prev, moment):
            continue
        day = slate_date(prev)
        if not day or day not in slate_dates:
            continue
        carried = dict(prev)
        carried["removed"] = True
        carried["pp_status"] = "removed"
        carried["projection_id"] = pid
        merged.append(carried)
        present.add(pid)
    _stamp_fetch_count(merged, len(fetched))
    return merged


def _stamp_fetch_count(rows, count) -> None:
    for row in rows:
        row["prizepicks_fetch_count"] = count


def next_page_url(url: str, payload) -> str | None:
    """links.next when PrizePicks sent one, otherwise the next meta page."""
    if not isinstance(payload, dict):
        return None
    links = payload.get("links")
    if isinstance(links, dict) and links.get("next"):
        return absolute_prizepicks_url(url, str(links.get("next")).strip())
    meta = payload.get("meta")
    if not isinstance(meta, dict):
        return None
    try:
        current = int(meta.get("current_page") or 0)
        total = int(meta.get("total_pages") or 0)
    except (TypeError, ValueError):
        return None
    if current <= 0 or total <= current:
        return None
    return _with_page(url, current + 1)


def absolute_prizepicks_url(base: str, nxt: str) -> str:
    if nxt.startswith("http://") or nxt.startswith("https://"):
        return nxt
    if nxt.startswith("//"):
        return "https:" + nxt
    if nxt.startswith("?"):
        parts = urlparse(base)
        return urlunparse((parts.scheme, parts.netloc, parts.path, "", nxt[1:], ""))
    if "://" not in nxt and not nxt.startswith("/") and "/" in nxt:
        return "https://" + nxt
    return urljoin(base, nxt)


def _with_page(url: str, page: int) -> str:
    parts = urlparse(url)
    query = [(key, value) for key, value in parse_qsl(parts.query, keep_blank_values=True) if key != "page"]
    query.append(("page", str(page)))
    return urlunparse(parts._replace(query=urlencode(query)))


def merge_prizepicks_pages(pages) -> dict:
    data = []
    included = []
    seen_data = set()
    seen_included = set()
    for page in pages or []:
        if not isinstance(page, dict):
            continue
        for item in page.get("data") or []:
            if not isinstance(item, dict):
                continue
            ident = str(item.get("id"))
            if ident in seen_data:
                continue
            seen_data.add(ident)
            data.append(item)
        for item in page.get("included") or []:
            if not isinstance(item, dict):
                continue
            ident = (item.get("type"), str(item.get("id")))
            if ident in seen_included:
                continue
            seen_included.add(ident)
            included.append(item)
    return {"data": data, "included": included}


def collect_prizepicks_pages(url, fetch_json, max_pages=40):
    """Follow links.next, then meta current_page/total_pages.

    A later page that errors, or a page cap hit before the last page, fails
    the whole fetch. A partial id list must not be treated as the lines
    PrizePicks took down.
    """
    pages = []
    seen_urls = set()
    seen_ids = set()
    pending = url
    while pending and len(pages) < max_pages:
        if pending in seen_urls:
            pending = None
            break
        seen_urls.add(pending)
        try:
            payload = fetch_json(pending)
        except Exception as exc:
            return None, exc
        if not isinstance(payload, dict):
            return None, ValueError("PrizePicks page was not a JSON object")
        page_ids = prizepicks_projection_ids(payload)
        if pages and page_ids and not any(item not in seen_ids for item in page_ids):
            pending = None
            break
        seen_ids.update(page_ids)
        pages.append(payload)
        nxt = next_page_url(pending, payload)
        if not nxt or nxt in seen_urls:
            pending = None
            break
        pending = nxt
    if pending:
        return None, RuntimeError("PrizePicks page limit reached before the last page")
    if not pages:
        return None, ValueError("PrizePicks fetch returned no pages")
    return merge_prizepicks_pages(pages), None


def read_local_board(path) -> list:
    file_path = Path(path)
    if not file_path.is_file():
        return []
    try:
        payload = json.loads(file_path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return []
    if isinstance(payload, list):
        return payload
    if isinstance(payload, dict) and isinstance(payload.get("data"), list):
        return payload["data"]
    return []


def published_board_url(base: str, table: str) -> str:
    return f"{str(base).rstrip('/')}/rest/v1/{table}?id=eq.1&select=data"


def rows_from_supabase_body(body) -> list:
    """PostgREST returns [{data: board}] for `select=data` on the id=1 snapshot."""
    if isinstance(body, list) and body and isinstance(body[0], dict) and isinstance(body[0].get("data"), list):
        return body[0]["data"]
    if isinstance(body, dict) and isinstance(body.get("data"), list):
        return body["data"]
    if isinstance(body, list):
        return [row for row in body if isinstance(row, dict)]
    return []


def _anon_key(env) -> str:
    """Publishable client key. The service role is never used for this read."""
    for name in ("VITE_SUPABASE_ANON_KEY", "SUPABASE_ANON_KEY"):
        text = str(env.get(name) or "").replace("\\n", "").strip().strip('"').strip("'")
        if text:
            return text
    return ""


def load_published_board(table: str, *, env=None, get=None) -> list:
    """GET the published board with the anon key.

    Empty when the key is missing or Postgres denies the anon role. That
    denial is not retried with the service role.
    """
    env = os.environ if env is None else env
    base = str(env.get("SUPABASE_URL") or env.get("VITE_SUPABASE_URL") or "").strip()
    key = _anon_key(env)
    if not base or not key:
        return []
    url = published_board_url(base, table)
    headers = {
        "apikey": key,
        "Authorization": f"Bearer {key}",
        "Accept": "application/json",
    }
    try:
        if get is None:
            import requests
            response = requests.get(url, headers=headers, timeout=30)
            response.raise_for_status()
            body = response.json()
        else:
            body = get(url, headers)
    except Exception:
        return []
    rows = rows_from_supabase_body(body)
    return rows if isinstance(rows, list) else []


def previous_board_rows(paths, table: str, *, env=None, get=None) -> list:
    """Local board file when this checkout has one, otherwise the Supabase snapshot.

    GitHub Actions checks out a clean tree. nfl/projections.json and
    nhl/projections.json are gitignored and are not restored from an artifact.
    The fallback is a GET of nhl_projections or nfl_projections (id = 1) with
    the anon key. Row-level security currently denies that role, so a blocked
    read leaves no previous board instead of using the service role.
    """
    if isinstance(paths, (str, Path)):
        paths = [paths]
    for path in paths or []:
        rows = read_local_board(path)
        if rows:
            return rows
    return load_published_board(table, env=env, get=get)

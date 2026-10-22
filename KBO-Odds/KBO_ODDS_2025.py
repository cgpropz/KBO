import os
import json
import sys
import time
import requests
import pandas as pd
import urllib3
urllib3.disable_warnings(urllib3.exceptions.InsecureRequestWarning)

HEADERS = {
    "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) "
                  "AppleWebKit/537.36 (KHTML, like Gecko) "
                  "Chrome/131.0.0.0 Safari/537.36",
    "Accept": "application/json",
    "Referer": "https://app.prizepicks.com/",
    "Origin": "https://app.prizepicks.com",
}
# The unfiltered board is every league and is large enough that a per_page cap
# can omit KBO. league_id 135 is the KBO league on partner-api.prizepicks.com.
PP_URL = "https://partner-api.prizepicks.com/projections"
KBO_LEAGUE_ID = "135"
MAX_RETRIES = 4
# Two clean HTTP 200 answers from the KBO league filter with no rows is
# PrizePicks saying there are no KBO lines (not a fetch failure).
CONFIRM_EMPTY_AFTER = 2
PULL_STATUS_FILE = "prizepicks_kbo_pull.json"
BACKOFF_CAP_SECONDS = 30.0
SNIPPET_CHARS = 180


def response_snippet(text, limit=SNIPPET_CHARS):
    """One short line of the response body for the workflow log."""
    compact = " ".join(str(text or "").split())
    return compact[:limit]


def backoff_seconds(attempt, retry_after=None):
    """Exponential delay. Honor Retry-After when PrizePicks sends one."""
    if retry_after not in (None, ""):
        try:
            parsed = float(str(retry_after).strip())
        except (TypeError, ValueError):
            parsed = None
        if parsed is not None and parsed > 0:
            return min(BACKOFF_CAP_SECONDS, parsed)
    return min(BACKOFF_CAP_SECONDS, 2.0 * (2 ** (attempt - 1)))


def _league_summary(payload):
    counts = {}
    for item in payload.get("included") or []:
        attrs = item.get("attributes") or {}
        if item.get("type") not in (None, "new_player"):
            continue
        if "name" not in attrs:
            continue
        league = str(attrs.get("league"))
        counts[league] = counts.get(league, 0) + 1
    top = sorted(counts.items(), key=lambda pair: pair[1], reverse=True)[:8]
    return ", ".join(f"{name}:{count}" for name, count in top) or "none"


def frame_from_payload(prizepicks):
    """Build the KBO odds frame from one PrizePicks projections payload."""
    library = {}
    for included in prizepicks.get("included") or []:
        attrs = included.get("attributes") or {}
        if "name" in attrs:
            library[included.get("id")] = {
                "name": attrs.get("name"),
                "team": attrs.get("team", "N/A"),
                "league": attrs.get("league", "N/A"),
                "image_url": attrs.get("image_url") or "",
            }

    rows = []
    for ppdata in prizepicks.get("data") or []:
        player_id = (
            ppdata.get("relationships", {})
            .get("new_player", {})
            .get("data", {})
            .get("id", "N/A")
        )
        player = library.get(player_id, {"name": "Unknown", "team": "N/A", "league": "N/A", "image_url": ""})
        name = player["name"]
        if player["league"] != "KBO" or not name or "+" in str(name):
            continue
        attrs = ppdata.get("attributes") or {}
        # start_time is an absolute timestamp from PrizePicks. The board cutoff
        # reads it when the official schedule has no matching game. It is not
        # a projection input.
        rows.append((
            name,
            player["league"],
            player["team"],
            attrs.get("stat_type", "N/A"),
            attrs.get("description", "N/A"),
            attrs.get("line_score", "N/A"),
            attrs.get("odds_type", "N/A"),
            attrs.get("start_time") or attrs.get("board_time") or "",
            player.get("image_url") or "",
        ))

    return pd.DataFrame(rows, columns=[
        "Name", "League", "Team", "Stat", "Versus", "Prizepicks", "Odds Type", "Start Time", "Image URL",
    ])


def _log_http(log, attempt, response):
    snippet = response_snippet(getattr(response, "text", ""))
    log(f"  ⚠ Attempt {attempt}: HTTP {response.status_code} body={snippet!r}")


def _request_kbo(get, params, attempt, log):
    """Return (frame or None, status_code or None). None frame means try again."""
    try:
        response = get(PP_URL, params=params, headers=HEADERS, timeout=30, verify=False)
    except (requests.RequestException, OSError) as exc:
        log(f"  ⚠ Attempt {attempt}: request error {exc}")
        return None, None

    status = getattr(response, "status_code", None)
    if status != 200:
        _log_http(log, attempt, response)
        retry_after = None
        headers = getattr(response, "headers", None) or {}
        try:
            retry_after = headers.get("Retry-After")
        except Exception:
            retry_after = None
        return None, status if retry_after is None else (status, retry_after)

    try:
        payload = response.json()
    except (ValueError, TypeError) as exc:
        log(
            f"  ⚠ Attempt {attempt}: HTTP {status} but JSON decode failed ({exc}); "
            f"body={response_snippet(getattr(response, 'text', ''))!r}"
        )
        return None, status

    if not isinstance(payload, dict):
        log(f"  ⚠ Attempt {attempt}: HTTP {status} JSON was {type(payload).__name__}, not an object")
        return None, status

    frame = frame_from_payload(payload)
    data_count = len(payload.get("data") or [])
    if len(frame) == 0:
        log(
            f"  ⚠ Attempt {attempt}: HTTP {status} but 0 KBO rows "
            f"(data={data_count}, leagues={_league_summary(payload)}); "
            f"body={response_snippet(getattr(response, 'text', ''))!r}"
        )
        return frame, status
    log(f"  ✓ Attempt {attempt}: HTTP {status} league filter={params.get('league_id', 'none')} kbo_rows={len(frame)} data={data_count}")
    return frame, status


def _retry_delay(attempt, status):
    retry_after = None
    status_code = status
    if isinstance(status, tuple):
        status_code, retry_after = status
    return backoff_seconds(attempt, retry_after), status_code


def _clean_empty(frame, status):
    """True for a parsed HTTP 200 with zero KBO rows (not an error)."""
    code = status[0] if isinstance(status, tuple) else status
    return frame is not None and len(frame) == 0 and code == 200


def fetch_kbo_lines(get, sleep=time.sleep, load_cached=None, log=print):
    """Fetch KBO lines, retrying transient HTTP failures and empty boards.

    Returns (dataframe, source). source is:
      'fresh'            live KBO lines.
      'confirmed_empty'  PrizePicks answered HTTP 200 with no KBO lines on the
                         league filter CONFIRM_EMPTY_AFTER times, and the
                         unfiltered board had none either (or errored). The
                         frame is the last saved file so projections still
                         build; the board marks every prop pulled.
      'cache'            fetch errors only (non-200, exception, timeout, bad
                         JSON): the last saved file is the fallback.
      'empty'            nothing fetched and no saved file.
    """
    if load_cached is None:
        load_cached = _load_cached

    last_status = None
    clean_empty = 0
    filtered = {"league_id": KBO_LEAGUE_ID, "per_page": 1000}
    for attempt in range(1, MAX_RETRIES + 1):
        frame, status = _request_kbo(get, filtered, attempt, log)
        last_status = status[0] if isinstance(status, tuple) else status
        if frame is not None and len(frame) > 0:
            frame.attrs["kbo_complete"] = True
            return frame, "fresh"
        if _clean_empty(frame, status):
            clean_empty += 1
            if clean_empty >= CONFIRM_EMPTY_AFTER:
                # Stop retrying an empty board: more calls only earn a 429.
                break
        if attempt < MAX_RETRIES:
            delay, _status_code = _retry_delay(attempt, status)
            log(f"  ⏳ retrying in {delay:.0f}s")
            sleep(delay)

    log("  ⚠ Filtered KBO request did not return lines; trying the unfiltered board once")
    frame, status = _request_kbo(get, {"per_page": 1000}, MAX_RETRIES + 1, log)
    last_status = status[0] if isinstance(status, tuple) else status
    if frame is not None and len(frame) > 0:
        # The all-league board is capped by per_page and can omit KBO lines,
        # so a line missing from it is not proof the line was pulled.
        frame.attrs["kbo_complete"] = False
        return frame, "fresh"

    if clean_empty >= CONFIRM_EMPTY_AFTER:
        log(f"  ✓ PrizePicks confirmed 0 KBO lines ({clean_empty} clean HTTP 200 responses); props will be marked pulled")
        cached = load_cached()
        return (cached if cached is not None else pd.DataFrame()), "confirmed_empty"

    cached = load_cached()
    if cached is not None and not cached.empty:
        log(f"  ↳ Keeping {len(cached)} last-good lines (last HTTP status={last_status})")
        return cached, "cache"
    log(f"  ✗ No KBO lines and no last-good cache (last HTTP status={last_status})")
    return cached if cached is not None else pd.DataFrame(), "empty"


def dfs_scraper():
    """Historical entry point. Returns a frame; does not exit the process."""
    frame, source = fetch_kbo_lines(requests.get)
    if source == "empty":
        return _load_cached()
    return frame


def _line_value(value):
    try:
        return float(value)
    except (TypeError, ValueError):
        return None


def pull_status_payload(source, frame=None, now=None):
    """What the last PrizePicks KBO pull saw, for the board's pulled-line check.

    'fresh' lists every live line (name, stat, line, odds type). Only 'fresh'
    and 'confirmed_empty' mark props pulled; any other status marks nothing.
    """
    from datetime import datetime, timezone
    checked = (now or datetime.now(timezone.utc)).astimezone(timezone.utc).replace(microsecond=0).isoformat()
    payload = {"status": source, "checked_at": checked, "lines": []}
    if source == "confirmed_empty":
        until = _confirmed_empty_valid_until(checked)
        if until:
            payload["valid_until"] = until
    if source == "fresh":
        # Only the KBO league-filter answer is complete enough to say a
        # specific line is gone.
        payload["complete"] = bool(getattr(frame, "attrs", {}).get("kbo_complete", False)) if frame is not None else False
    if source == "fresh" and frame is not None and not frame.empty:
        lines = []
        for row in frame.to_dict("records"):
            lines.append({
                "name": str(row.get("Name") or ""),
                "stat": str(row.get("Stat") or ""),
                "line": _line_value(row.get("Prizepicks")),
                "odds_type": str(row.get("Odds Type") or "standard").lower(),
            })
        payload["lines"] = lines
    return payload


CONFIRMED_STATUS_MAX_AGE_SECONDS = 3 * 3600


def _pulled_lines_module():
    repo = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    if repo not in sys.path:
        sys.path.insert(0, repo)
    from pipeline import kbo_pulled_lines
    return kbo_pulled_lines


def _confirmed_empty_valid_until(checked_iso):
    """ISO time of the slate's first pitch for a confirmed-empty pull."""
    from datetime import datetime
    try:
        checked = datetime.fromisoformat(str(checked_iso).replace("Z", "+00:00"))
        return _pulled_lines_module().confirmed_empty_valid_until(checked).replace(microsecond=0).isoformat()
    except Exception as exc:  # never block the odds step on this
        print(f"  ↳ could not work out the KBO first pitch for the empty pull: {exc}")
        return None


def _board_confirmed_empty(board_path, now=None):
    """The restored board's in-force confirmed_empty pull, else None."""
    from datetime import datetime, timezone
    try:
        return _pulled_lines_module().board_pull_status(board_path, now or datetime.now(timezone.utc))
    except Exception as exc:  # never block the odds step on this
        print(f"  ↳ could not read the restored board's pull status: {exc}")
        return None


def _confirmed_status_to_keep(path, now=None, incoming=None, board_path=None):
    """The last confirming status to keep instead of ``incoming``, else None.

    confirmed_empty stands until the slate's first pitch (or a complete fresh
    pull). A complete fresh pull stands for 3 hours against errors.

    The status file is often missing on a fresh checkout (its commit loses
    the push race), so the restored board's prizepicks_pull is the fallback:
    an in-force confirmed_empty there is kept when the file is missing, not
    confirming, or older than the board's check. ``board_path=None`` skips
    the board (explicit test paths stay hermetic)."""
    from datetime import datetime, timezone
    now = now or datetime.now(timezone.utc)
    board = _board_confirmed_empty(board_path, now) if board_path is not None else None
    try:
        with open(path, encoding="utf-8") as handle:
            previous = json.load(handle)
    except (OSError, ValueError):
        previous = None
    if not isinstance(previous, dict):
        return board
    kept = None
    if previous.get("status") == "confirmed_empty":
        try:
            in_force = _pulled_lines_module().confirmed_empty_in_force(previous, now)
        except Exception as exc:
            print(f"  ↳ could not check the last confirmed-empty pull: {exc}")
            in_force = False
        kept = previous if in_force else None
    else:
        confirming = previous.get("status") == "fresh" and previous.get("complete") is True
        if confirming and (incoming or {}).get("status") != "fresh":
            try:
                checked = datetime.fromisoformat(str(previous.get("checked_at")).replace("Z", "+00:00"))
            except ValueError:
                checked = None
            if checked is not None:
                if checked.tzinfo is None:
                    checked = checked.replace(tzinfo=timezone.utc)
                age = (now - checked).total_seconds()
                kept = previous if 0 <= age <= CONFIRMED_STATUS_MAX_AGE_SECONDS else None
    if board is None:
        return kept
    if kept is None:
        return board
    try:
        mine = datetime.fromisoformat(str(kept.get("checked_at")).replace("Z", "+00:00"))
        theirs = datetime.fromisoformat(str(board.get("checked_at")).replace("Z", "+00:00"))
        if mine.tzinfo is None:
            mine = mine.replace(tzinfo=timezone.utc)
        if theirs.tzinfo is None:
            theirs = theirs.replace(tzinfo=timezone.utc)
    except ValueError:
        return board
    return board if theirs > mine else kept


def write_pull_status(payload, path=None, now=None, board_path=None):
    """Write the pull status. A fetch error or partial save does not replace
    a confirming status under 3 hours old: a run of 429s after PrizePicks
    confirmed 0 KBO lines must not bring the pulled props back.

    With no explicit ``path`` the restored board
    (kbo-props-ui/public/data/prizepicks_props.json) is also checked, and a
    confirmed_empty kept from it is written to the status file."""
    base = os.path.dirname(os.path.abspath(__file__))
    default_path = path is None
    path = path or os.environ.get("KBO_PULL_STATUS_PATH") or os.path.join(base, PULL_STATUS_FILE)
    if board_path is None and default_path:
        try:
            board_path = _pulled_lines_module().board_path()
        except Exception as exc:
            print(f"  ↳ restored board path unavailable: {exc}")
            board_path = None
    # Only a complete fresh pull replaces a confirmed_empty before first pitch.
    replaceable = payload.get("status") in ("fetch_error", "partial") or (
        payload.get("status") == "fresh" and payload.get("complete") is not True
    )
    if replaceable:
        kept = _confirmed_status_to_keep(path, now, payload, board_path)
        if kept is not None:
            print(
                f"PrizePicks KBO pull status: {payload['status']}; keeping the {kept['status']} status "
                f"from {kept.get('checked_at')}"
                + (" (restored board)" if kept.get("source") == "restored_board" else "")
            )
            if kept.get("source") == "restored_board":
                # Persist it so the next run (and main) has the status file.
                with open(path, "w", encoding="utf-8") as handle:
                    json.dump(kept, handle, indent=2)
                    handle.write("\n")
            return kept
    with open(path, "w", encoding="utf-8") as handle:
        json.dump(payload, handle, indent=2)
        handle.write("\n")
    print(f"PrizePicks KBO pull status: {payload['status']} ({len(payload['lines'])} lines) → {os.path.basename(path)}")
    return payload


def _write_run_signal(source, frame=None):
    """Count-only record of this pull for checks later in the same job."""
    try:
        repo = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
        if repo not in sys.path:
            sys.path.insert(0, repo)
        from pipeline.kbo_run_signal import write_signal
        count = 0 if source == "confirmed_empty" else (len(frame) if source == "fresh" and frame is not None else None)
        write_signal(source, count)
    except Exception as exc:  # never fail the fetch over the signal file
        print(f"  ! KBO run signal not written: {exc}")


def _load_cached():
    """Return the last saved JSON as a DataFrame so downstream steps still work."""
    base = os.path.dirname(os.path.abspath(__file__))
    cached = os.path.join(base, "KBO_odds_2025.json")
    if os.path.exists(cached):
        df = pd.read_json(cached)
        print(f"  ↳ Loaded {len(df)} cached lines from KBO_odds_2025.json")
        return df
    return pd.DataFrame(columns=["Name", "League", "Team", "Stat", "Versus", "Prizepicks", "Odds Type", "Start Time"])


def save_to_json(df):
    if df.empty:
        print("No new data to save — keeping existing files")
        return False
    base = os.path.dirname(os.path.abspath(__file__))
    out_json = os.path.join(base, "KBO_odds_2025.json")
    out_csv = os.path.join(base, "KBO_odds_2025.csv")

    pitcher_stats = {"Pitcher Strikeouts", "Hits Allowed", "Pitching Outs"}
    has_pitcher_markets = bool(set(df["Stat"].dropna()) & pitcher_stats)
    if not has_pitcher_markets and os.path.exists(out_json):
        try:
            with open(out_json, encoding="utf-8") as f:
                cached = pd.DataFrame(json.load(f))
            cached_has_pitcher_markets = bool(set(cached.get("Stat", [])) & pitcher_stats)
        except (OSError, ValueError, TypeError):
            cached_has_pitcher_markets = False
        if cached_has_pitcher_markets:
            print("✗ Refusing to overwrite cached pitcher markets with a batter-only response")
            return False

    df.to_json(out_json, orient="records", indent=2)
    df.to_csv(out_csv, index=False)
    print(f"Data saved to KBO_odds_2025.json + .csv ({len(df)} lines) ✅")
    return True


if __name__ == "__main__":
    df, source = fetch_kbo_lines(requests.get)
    if source == "confirmed_empty":
        # A real empty board, not an error. Keep the odds file so projections
        # still build, and record the empty pull so every KBO prop is marked
        # pulled and leaves the ranking, free top 3 and slips.
        write_pull_status(pull_status_payload("confirmed_empty"))
        _write_run_signal("confirmed_empty")
        print("⚠ PrizePicks has no KBO lines; keeping the odds file and marking every prop pulled")
        sys.exit(0)
    if source == "cache":
        write_pull_status(pull_status_payload("fetch_error"))
        _write_run_signal("fetch_error")
        # The live board had no usable KBO lines. Keep this file so pitcher and
        # batter projections are not rebuilt from nothing. It can still be a
        # finished game. The board publish drops those lines before they go out.
        print("⚠ Fresh PrizePicks fetch did not return KBO lines; using the last-good odds file")
        sys.exit(0)
    if source == "empty" or df is None or df.empty:
        print("✗ No KBO lines in the response and no last-good cache")
        _write_run_signal("empty")
        sys.exit(1)
    print("Scraping complete... saving local odds files")
    if not save_to_json(df):
        # Refused (batter-only response over cached pitcher markets): the
        # saved file is not this pull, so do not mark lines pulled from it.
        write_pull_status(pull_status_payload("partial"))
        _write_run_signal("partial")
        sys.exit(1)
    write_pull_status(pull_status_payload("fresh", df))
    _write_run_signal("fresh", df)
    print("Google Sheets sync disabled")

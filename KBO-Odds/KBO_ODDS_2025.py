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
            }

    rows = []
    for ppdata in prizepicks.get("data") or []:
        player_id = (
            ppdata.get("relationships", {})
            .get("new_player", {})
            .get("data", {})
            .get("id", "N/A")
        )
        player = library.get(player_id, {"name": "Unknown", "team": "N/A", "league": "N/A"})
        name = player["name"]
        if player["league"] != "KBO" or not name or "+" in str(name):
            continue
        attrs = ppdata.get("attributes") or {}
        rows.append((
            name,
            player["league"],
            player["team"],
            attrs.get("stat_type", "N/A"),
            attrs.get("description", "N/A"),
            attrs.get("line_score", "N/A"),
            attrs.get("odds_type", "N/A"),
        ))

    return pd.DataFrame(rows, columns=[
        "Name", "League", "Team", "Stat", "Versus", "Prizepicks", "Odds Type",
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


def fetch_kbo_lines(get, sleep=time.sleep, load_cached=None, log=print):
    """Fetch KBO lines, retrying transient HTTP failures and empty boards.

    Returns (dataframe, source) where source is 'fresh', 'cache', or 'empty'.
    An empty live board keeps the last saved file instead of wiping it.
    """
    if load_cached is None:
        load_cached = _load_cached

    last_status = None
    filtered = {"league_id": KBO_LEAGUE_ID, "per_page": 1000}
    for attempt in range(1, MAX_RETRIES + 1):
        frame, status = _request_kbo(get, filtered, attempt, log)
        last_status = status[0] if isinstance(status, tuple) else status
        if frame is not None and len(frame) > 0:
            return frame, "fresh"
        if attempt < MAX_RETRIES:
            delay, _status_code = _retry_delay(attempt, status)
            log(f"  ⏳ retrying in {delay:.0f}s")
            sleep(delay)

    log("  ⚠ Filtered KBO request did not return lines; trying the unfiltered board once")
    frame, status = _request_kbo(get, {"per_page": 1000}, MAX_RETRIES + 1, log)
    last_status = status[0] if isinstance(status, tuple) else status
    if frame is not None and len(frame) > 0:
        return frame, "fresh"

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


def _load_cached():
    """Return the last saved JSON as a DataFrame so downstream steps still work."""
    base = os.path.dirname(os.path.abspath(__file__))
    cached = os.path.join(base, "KBO_odds_2025.json")
    if os.path.exists(cached):
        df = pd.read_json(cached)
        print(f"  ↳ Loaded {len(df)} cached lines from KBO_odds_2025.json")
        return df
    return pd.DataFrame(columns=["Name", "League", "Team", "Stat", "Versus", "Prizepicks", "Odds Type"])


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
    if source == "cache":
        # The live board had no usable KBO lines. Keep the file as-is so a
        # formatter diff is not committed, and let the pipeline publish on it.
        print("⚠ Fresh PrizePicks fetch did not return KBO lines; using the last-good odds file")
        sys.exit(0)
    if source == "empty" or df is None or df.empty:
        print("✗ No KBO lines in the response and no last-good cache")
        sys.exit(1)
    print("Scraping complete... saving local odds files")
    if not save_to_json(df):
        sys.exit(1)
    print("Google Sheets sync disabled")

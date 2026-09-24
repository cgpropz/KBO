"""Shared helpers for props memory freeze + grade."""
from __future__ import annotations

import json
import re
import unicodedata
from datetime import date, datetime, timedelta, timezone
from pathlib import Path
from typing import Any, Iterable

REPO_ROOT = Path(__file__).resolve().parents[2]
MEMORY_ROOT = REPO_ROOT / "memory"
PUBLIC_DATA = REPO_ROOT / "kbo-props-ui" / "public" / "data"

KST = timezone(timedelta(hours=9))
ET = timezone(timedelta(hours=-4))  # EDT approximation for labels; prefer ZoneInfo when available

SPORTS = ("kbo", "wnba", "nfl")
TIMEZONE_BASIS = {
    "kbo": "KST",
    "wnba": "ET",
    "nfl": "ET-gameday",
}

RESULT_OVER = "OVER"
RESULT_UNDER = "UNDER"
RESULT_PUSH = "PUSH"
RESULT_DNP = "DNP"

MODEL_HIT = "HIT"
MODEL_MISS = "MISS"
MODEL_PUSH = "PUSH"
MODEL_NA = "N/A"


def utc_now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def normalize_name(name: str) -> str:
    nfkd = unicodedata.normalize("NFKD", str(name or ""))
    return "".join(c for c in nfkd if not unicodedata.combining(c)).strip().lower()


def parse_date(value: Any) -> date | None:
    """Parse mm/dd/YYYY, YYYY-MM-DD, YYYYMMDD, or datetime-ish strings to date."""
    if value is None:
        return None
    if isinstance(value, datetime):
        return value.date()
    if isinstance(value, date):
        return value
    raw = str(value).strip()
    if not raw:
        return None
    for fmt in ("%m/%d/%Y", "%Y-%m-%d", "%Y%m%d", "%m/%d/%y"):
        try:
            return datetime.strptime(raw[:10] if fmt != "%Y%m%d" else raw[:8], fmt).date()
        except ValueError:
            continue
    # ISO with time
    try:
        return datetime.fromisoformat(raw.replace("Z", "+00:00")).date()
    except ValueError:
        return None


def format_mmddyyyy(d: date) -> str:
    return d.strftime("%m/%d/%Y")


def format_iso(d: date) -> str:
    return d.strftime("%Y-%m-%d")


def date_path_parts(d: date) -> tuple[str, str, str]:
    """Return (mm, dd, yyyy) path segments."""
    return d.strftime("%m"), d.strftime("%d"), d.strftime("%Y")


def memory_dir(sport: str, d: date) -> Path:
    sport = sport.lower()
    if sport not in SPORTS:
        raise ValueError(f"Unknown sport: {sport}")
    mm, dd, yyyy = date_path_parts(d)
    return MEMORY_ROOT / sport / mm / dd / yyyy


def ensure_memory_dir(sport: str, d: date) -> Path:
    path = memory_dir(sport, d)
    path.mkdir(parents=True, exist_ok=True)
    return path


def load_json(path: Path, default: Any = None) -> Any:
    if not path.exists():
        return default
    with path.open(encoding="utf-8") as handle:
        return json.load(handle)


def save_json(path: Path, data: Any) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("w", encoding="utf-8") as handle:
        json.dump(data, handle, indent=2, ensure_ascii=False)
        handle.write("\n")


def prop_key(prop: dict) -> tuple[str, str, str]:
    """Stable merge key: player + stat + odds_type."""
    player = normalize_name(prop.get("player") or prop.get("name") or "")
    stat = str(prop.get("stat") or prop.get("prop") or "").strip().lower()
    odds_type = str(prop.get("odds_type") or "standard").strip().lower()
    return player, stat, odds_type


def merge_slate_props(existing: list[dict], incoming: list[dict]) -> list[dict]:
    """Merge by player+stat+odds_type; newer incoming fields win."""
    by_key: dict[tuple[str, str, str], dict] = {}
    for prop in existing or []:
        by_key[prop_key(prop)] = dict(prop)
    for prop in incoming or []:
        key = prop_key(prop)
        if not key[0] or not key[1]:
            continue
        merged = dict(by_key.get(key) or {})
        merged.update({k: v for k, v in prop.items() if v is not None})
        by_key[key] = merged
    return sorted(by_key.values(), key=lambda p: (normalize_name(p.get("player", "")), str(p.get("stat", "")), str(p.get("odds_type", ""))))


def grade_line(actual: float | int | None, line: float | int | None) -> str:
    """Return OVER / UNDER / PUSH for a numeric actual vs line."""
    if actual is None or line is None:
        raise ValueError("actual and line required")
    actual_f = float(actual)
    line_f = float(line)
    if actual_f > line_f:
        return RESULT_OVER
    if actual_f < line_f:
        return RESULT_UNDER
    return RESULT_PUSH


def model_result(outcome: str, recommendation: str | None) -> str:
    """HIT/MISS/PUSH/N/A vs model recommendation direction."""
    if outcome == RESULT_DNP:
        return MODEL_NA
    if outcome == RESULT_PUSH:
        return MODEL_PUSH
    rec = (recommendation or "").strip().upper()
    if rec in ("OVER", "UNDER"):
        return MODEL_HIT if outcome == rec else MODEL_MISS
    if "OV" in rec:
        return MODEL_HIT if outcome == RESULT_OVER else MODEL_MISS
    if "UN" in rec:
        return MODEL_HIT if outcome == RESULT_UNDER else MODEL_MISS
    return MODEL_NA



SUMMARY_PROP_KEYS = ("player", "team", "stat", "odds_type", "line", "actual", "side", "model_result")


def summary_prop_entry(prop: dict) -> dict:
    """Slim prop row for summary.json hit/miss lists."""
    side = prop.get("side") or prop.get("recommendation") or prop.get("pick")
    entry = {
        "player": prop.get("player") or prop.get("name") or "",
        "stat": prop.get("stat") or prop.get("prop") or "",
        "odds_type": prop.get("odds_type") or "standard",
        "line": prop.get("line"),
        "actual": prop.get("actual"),
        "side": side,
        "model_result": prop.get("model_result"),
    }
    team = prop.get("team")
    if team not in (None, ""):
        entry["team"] = team
    return entry


def compute_hit_rate_stats(props: Iterable[dict]) -> dict[str, Any]:
    """
    Aggregate HIT/MISS/PUSH/DNP counts and hit rate from graded props.

    Hit rate denominator is hits + misses only (PUSH / DNP / N/A excluded).
    """
    hits = 0
    misses = 0
    pushes = 0
    dnps = 0
    props_hit: list[dict] = []
    props_miss: list[dict] = []

    for prop in props or []:
        mr = str(prop.get("model_result") or "").strip().upper()
        result = str(prop.get("result") or "").strip().upper()
        if mr == MODEL_HIT:
            hits += 1
            props_hit.append(summary_prop_entry(prop))
        elif mr == MODEL_MISS:
            misses += 1
            props_miss.append(summary_prop_entry(prop))
        elif mr == MODEL_PUSH or result == RESULT_PUSH:
            pushes += 1
        elif mr in (MODEL_NA, "") and result == RESULT_DNP:
            dnps += 1
        elif result == RESULT_DNP:
            dnps += 1
        elif mr == MODEL_NA:
            # Graded without a usable recommendation — exclude from hit rate
            pass
        else:
            # Unknown model_result: do not inflate hit rate
            pass

    denom = hits + misses
    hit_rate = round(hits / denom, 6) if denom else None
    hit_rate_pct = round(hits / denom * 100, 1) if denom else None
    return {
        "hits": hits,
        "misses": misses,
        "pushes": pushes,
        "dnps": dnps,
        "hit_rate": hit_rate,
        "hit_rate_pct": hit_rate_pct,
        "props_hit": props_hit,
        "props_miss": props_miss,
    }


def hit_rate_meta_extra(stats: dict) -> dict:
    """Fields to merge into meta.json when a summary is available."""
    return {
        "hits": stats.get("hits", 0),
        "misses": stats.get("misses", 0),
        "pushes": stats.get("pushes", 0),
        "dnps": stats.get("dnps", 0),
        "hit_rate": stats.get("hit_rate"),
        "hit_rate_pct": stats.get("hit_rate_pct"),
    }


def build_day_summary(
    sport: str,
    d: date,
    props: list[dict],
    *,
    status: str,
    props_total: int | None = None,
) -> dict:
    """Build the in-memory summary.json payload (does not write)."""
    sport = sport.lower()
    if sport not in SPORTS:
        raise ValueError(f"Unknown sport: {sport}")
    if status not in ("complete", "partial"):
        raise ValueError(f"summary status must be complete|partial, got {status!r}")

    graded = list(props or [])
    stats = compute_hit_rate_stats(graded)
    total = props_total if props_total is not None else len(graded)
    return {
        "sport": sport,
        "slate_date": format_mmddyyyy(d),
        "slate_date_iso": format_iso(d),
        "timezone_basis": TIMEZONE_BASIS[sport],
        "status": status,
        "props_total": total,
        "props_graded": len(graded),
        "hits": stats["hits"],
        "misses": stats["misses"],
        "pushes": stats["pushes"],
        "dnps": stats["dnps"],
        "hit_rate": stats["hit_rate"],
        "hit_rate_pct": stats["hit_rate_pct"],
        "props_hit": stats["props_hit"],
        "props_miss": stats["props_miss"],
        "updated_at": utc_now_iso(),
    }


def write_day_summary(
    sport: str,
    d: date,
    props: list[dict],
    *,
    status: str,
    props_total: int | None = None,
) -> tuple[Path, dict]:
    """
    Write memory/<sport>/mm/dd/yyyy/summary.json from graded props.

    Call on complete (via write_recap) and on partial when any props graded.
    Returns (path, summary_dict).
    """
    summary = build_day_summary(
        sport, d, props, status=status, props_total=props_total
    )
    path = ensure_memory_dir(sport, d) / "summary.json"
    save_json(path, summary)
    return path, summary


def write_partial_progress(
    sport: str,
    d: date,
    graded: list[dict],
    *,
    props_total: int,
    missing: list[Any] | None = None,
) -> Path:
    """
    Persist meta for waiting|partial days; write summary.json when any props graded.

    Does not write recap.json (complete-only).
    """
    n_graded = len(graded or [])
    status = "partial" if n_graded else "waiting"
    extra = None
    if n_graded:
        _, summary = write_day_summary(
            sport, d, graded, status="partial", props_total=props_total
        )
        extra = hit_rate_meta_extra(summary)
    return write_meta(
        sport,
        d,
        status=status,
        props_total=props_total,
        props_graded=n_graded,
        missing=missing or [],
        extra=extra,
    )


def write_meta(
    sport: str,
    d: date,
    *,
    status: str,
    props_total: int,
    props_graded: int,
    missing: list[Any] | None = None,
    extra: dict | None = None,
) -> Path:
    path = ensure_memory_dir(sport, d) / "meta.json"
    missing_list = list(missing or [])
    missing_truncated = False
    if len(missing_list) > 50:
        missing_list = missing_list[:50]
        missing_truncated = True
    payload = {
        "sport": sport,
        "slate_date": format_mmddyyyy(d),
        "slate_date_iso": format_iso(d),
        "timezone_basis": TIMEZONE_BASIS[sport],
        "status": status,
        "props_total": props_total,
        "props_graded": props_graded,
        "missing": missing_list,
        "missing_truncated": missing_truncated,
        "updated_at": utc_now_iso(),
    }
    if extra:
        payload.update(extra)
    save_json(path, payload)
    return path


def write_slate(sport: str, d: date, props: list[dict], *, source: str | None = None) -> Path:
    day_dir = ensure_memory_dir(sport, d)
    slate_path = day_dir / "slate.json"
    existing = load_json(slate_path, default={}) or {}
    merged = merge_slate_props(existing.get("props") or [], props)
    payload = {
        "sport": sport,
        "slate_date": format_mmddyyyy(d),
        "slate_date_iso": format_iso(d),
        "timezone_basis": TIMEZONE_BASIS[sport],
        "frozen_at": utc_now_iso(),
        "source": source or existing.get("source"),
        "props": merged,
    }
    save_json(slate_path, payload)

    # Refresh meta unless already complete with a recap
    meta = load_json(day_dir / "meta.json", default={}) or {}
    if meta.get("status") != "complete" or not (day_dir / "recap.json").exists():
        write_meta(
            sport,
            d,
            status="waiting" if not meta.get("props_graded") else meta.get("status", "waiting"),
            props_total=len(merged),
            props_graded=int(meta.get("props_graded") or 0),
            missing=meta.get("missing") or [],
            extra={"note": "slate frozen/merged; awaiting finals gate"},
        )
    return slate_path


def write_recap(sport: str, d: date, props: list[dict], *, missing: list[Any] | None = None) -> Path:
    day_dir = ensure_memory_dir(sport, d)
    payload = {
        "sport": sport,
        "slate_date": format_mmddyyyy(d),
        "slate_date_iso": format_iso(d),
        "timezone_basis": TIMEZONE_BASIS[sport],
        "graded_at": utc_now_iso(),
        "props": props,
    }
    path = day_dir / "recap.json"
    save_json(path, payload)
    _, summary = write_day_summary(
        sport, d, props, status="complete", props_total=len(props)
    )
    write_meta(
        sport,
        d,
        status="complete",
        props_total=len(props),
        props_graded=len(props),
        missing=missing or [],
        extra=hit_rate_meta_extra(summary),
    )
    return path


def today_kst() -> date:
    return datetime.now(KST).date()


def yesterday_kst() -> date:
    return today_kst() - timedelta(days=1)


def today_et() -> date:
    try:
        from zoneinfo import ZoneInfo

        return datetime.now(ZoneInfo("America/New_York")).date()
    except Exception:
        return datetime.now(ET).date()


def parse_cli_date(value: str | None, default: date) -> date:
    if not value:
        return default
    parsed = parse_date(value)
    if not parsed:
        raise SystemExit(f"Could not parse --date {value!r}; use mm/dd/YYYY or YYYY-MM-DD")
    return parsed


def kst_game_date_from_meta() -> date | None:
    meta_path = REPO_ROOT / "Pitchers-Data" / "player_names_meta.json"
    meta = load_json(meta_path, default={}) or {}
    raw = meta.get("game_date")
    if not raw:
        return None
    return parse_date(str(raw))

#!/usr/bin/env python3
"""Compare a saved PP Odds snapshot with the current line-shift.

Reads a local snapshot JSON. That is the ``data`` object stored for
``nfl_sharp_odds`` or ``nhl_sharp_odds`` (a top-level ``records`` list).
A Supabase row wrapper ``{"data": {"records": ...}}`` is accepted too.

Each record is rebuilt with ``nfl.sharp_odds.build_snapshot`` from the
books already on that row. No network and no database. Exact book lines
are not shifted, so those rows must show no change.

    python scripts/sharp_line_shift_diff.py path/to/snapshot.json

Exit 1 when an exact-match row changes. Nearest-line changes are printed
and still exit 0.
"""
from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from nfl.sharp_odds import book_key, build_snapshot, name_key  # noqa: E402

COMPARED = (
    "pp_edge_over_flex",
    "pp_edge_under_flex",
    "pp_edge_over_power",
    "pp_edge_under_power",
    "pp_edge_flex",
    "pp_edge_power",
    "pp_edge_pct",
    "fair_over_pct",
    "fair_under_pct",
    "grade",
    "grade_flex",
    "grade_power",
)
GRADE_FIELDS = ("grade", "grade_flex", "grade_power")


def load_records(path):
    payload = json.loads(Path(path).read_text(encoding="utf-8"))
    records = _records_from(payload)
    if records is None:
        raise SystemExit(f"{path} has no records list")
    return records


def _records_from(payload):
    if isinstance(payload, list):
        return payload
    if not isinstance(payload, dict):
        return None
    if isinstance(payload.get("records"), list):
        return payload["records"]
    data = payload.get("data")
    if isinstance(data, dict) and isinstance(data.get("records"), list):
        return data["records"]
    return None


def _books(record):
    """Sportsbook rows at the matched line, from the snapshot's book_prices."""
    matched = record.get("matched_line")
    if matched is None:
        return []
    player = record.get("player")
    player_key = record.get("player_key") or name_key(player)
    prop = record.get("prop")
    rows = []
    for quote in record.get("book_prices") or []:
        if not isinstance(quote, dict):
            continue
        key = quote.get("book_key") or book_key(quote.get("book"))
        book = quote.get("book") or key
        for side in ("over", "under"):
            price = quote.get(side)
            if isinstance(price, bool) or not isinstance(price, (int, float)):
                continue
            rows.append(
                {
                    "player": player,
                    "player_key": player_key,
                    "prop": prop,
                    "side": side,
                    "line": matched,
                    "price": int(price),
                    "book": book,
                    "book_key": key,
                }
            )
    return rows


def recompute(record):
    """One record through the current build_snapshot path."""
    if not isinstance(record, dict) or record.get("pp_line") is None or not record.get("prop"):
        return None
    pp = dict(record)
    if not pp.get("player_key"):
        pp["player_key"] = name_key(pp.get("player"))
    fresh = build_snapshot([pp], _books(pp)).get("records") or []
    return fresh[0] if fresh else None


def _same(left, right):
    if left == right:
        return True
    try:
        return float(left) == float(right)
    except (TypeError, ValueError):
        return False


def _lines_equal(record):
    matched = record.get("matched_line")
    pp_line = record.get("pp_line")
    if matched is None or pp_line is None:
        return False
    return _same(matched, pp_line)


def is_exact(record):
    if record.get("line_match") == "exact":
        return True
    return _lines_equal(record)


def _side(record):
    side = record.get("recommendation")
    if side in {"OVER", "UNDER"}:
        return side
    return "—"


def _cell(old, new):
    return f"{_fmt(old)} -> {_fmt(new)}"


def _fmt(value):
    if value is None or value == "":
        return "—"
    if isinstance(value, float):
        return f"{value:.1f}"
    return str(value)


def diff_records(records):
    """Return counts and the rows whose edge, fair percent, or grade changed."""
    changed = []
    exact_changed = []
    grade_changes = 0
    exact_count = 0
    nearest_count = 0
    for record in records or []:
        if not isinstance(record, dict):
            continue
        exact = is_exact(record)
        if exact:
            exact_count += 1
        elif record.get("line_match") == "nearest" or (
            record.get("matched_line") is not None and record.get("pp_line") is not None and not exact
        ):
            nearest_count += 1
        fresh = recompute(record)
        if fresh is None:
            continue
        fields = [name for name in COMPARED if not _same(record.get(name), fresh.get(name))]
        if not fields:
            continue
        grade_fields = [name for name in GRADE_FIELDS if name in fields]
        if grade_fields:
            grade_changes += 1
        row = {
            "player": record.get("player") or "",
            "prop": record.get("prop") or "",
            "side": _side(record),
            "pp_line": record.get("pp_line"),
            "matched_line": record.get("matched_line"),
            "exact": exact,
            "fields": fields,
            "flex": _cell(record.get("pp_edge_flex"), fresh.get("pp_edge_flex")),
            "power": _cell(record.get("pp_edge_power"), fresh.get("pp_edge_power")),
            "fair_over": _cell(record.get("fair_over_pct"), fresh.get("fair_over_pct")),
            "fair_under": _cell(record.get("fair_under_pct"), fresh.get("fair_under_pct")),
            "grade": _cell(record.get("grade"), fresh.get("grade")),
            "grade_flex": _cell(record.get("grade_flex"), fresh.get("grade_flex")),
            "grade_power": _cell(record.get("grade_power"), fresh.get("grade_power")),
            "changed_fields": ", ".join(fields),
        }
        changed.append(row)
        if exact:
            exact_changed.append(row)
    return {
        "records": len([row for row in records or [] if isinstance(row, dict)]),
        "exact": exact_count,
        "nearest": nearest_count,
        "changed": changed,
        "exact_changed": exact_changed,
        "grade_changes": grade_changes,
    }


def _table(rows):
    headers = (
        "player",
        "prop",
        "side",
        "pp_line",
        "matched_line",
        "flex",
        "power",
        "fair_over",
        "fair_under",
        "grade",
        "grade_flex",
        "grade_power",
        "changed_fields",
    )
    display = [{key: _fmt(row[key]) if key in {"pp_line", "matched_line"} else str(row[key]) for key in headers} for row in rows]
    widths = {key: len(key) for key in headers}
    for row in display:
        for key in headers:
            widths[key] = max(widths[key], len(row[key]))
    def line(row):
        return "  ".join(row[key].ljust(widths[key]) for key in headers)
    head = {key: key for key in headers}
    body = [line(head), line({key: "-" * widths[key] for key in headers})]
    body.extend(line(row) for row in display)
    return "\n".join(body)


def render(summary):
    lines = [
        f"records: {summary['records']}",
        f"exact: {summary['exact']}",
        f"nearest: {summary['nearest']}",
        f"changed rows: {len(summary['changed'])}",
        f"grade changes: {summary['grade_changes']}",
        f"exact-match changes: {len(summary['exact_changed'])}",
    ]
    if summary["changed"]:
        lines.append("")
        lines.append(_table(summary["changed"]))
    else:
        lines.append("no rows changed")
    return "\n".join(lines)


def main(argv=None):
    parser = argparse.ArgumentParser(description="Diff a PP Odds snapshot against the current line shift")
    parser.add_argument("snapshot", type=Path, help="Local snapshot JSON (records, or a data wrapper)")
    args = parser.parse_args(argv)
    if not args.snapshot.is_file():
        raise SystemExit(f"snapshot not found: {args.snapshot}")
    summary = diff_records(load_records(args.snapshot))
    print(render(summary))
    return 1 if summary["exact_changed"] else 0


if __name__ == "__main__":
    raise SystemExit(main())

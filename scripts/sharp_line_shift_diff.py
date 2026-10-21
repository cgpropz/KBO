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
and still exit 0. Integer count lines also print the push probability
P(X = line), in percent. Half-point lines and yardage lines print a dash
because those models have no push mass.

The free PP Odds preview section is the same selection the site uses:
``selectFreeSharpOddsPreview`` in ``kbo-props-ui/api/_dataAccess.js``
(``nflSharpScore`` / ``nhlSharpScore``, ``topN``, ``FREE_ROW_LIMIT``), after
``isStandardBoardLine`` in ``kbo-props-ui/src/standardBoard.js``. A row is
eligible when ``line_match`` is ``exact``, or ``nearest`` and the book line
is at most half a point from the PrizePicks line. It sorts by the corrected
``pp_edge_flex``.
"""
from __future__ import annotations

import argparse
import json
import shutil
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from nfl.sharp_odds import (  # noqa: E402
    GRADE_RANK,
    _fair_probs,
    book_key,
    build_snapshot,
    name_key,
    pct,
    push_probability,
)

# kbo-props-ui/api/_dataAccess.js selectFreeSharpOddsPreview.
PREVIEW_SOURCE = (
    "kbo-props-ui/api/_dataAccess.js selectFreeSharpOddsPreview "
    "(nflSharpScore / nhlSharpScore, topN, FREE_ROW_LIMIT) after "
    "kbo-props-ui/src/standardBoard.js isStandardBoardLine; "
    "exact, or nearest within 0.5"
)

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


def snapshot_sport(payload, path=""):
    """nfl or nhl. The snapshot's sport field wins, then the file name."""
    sport = ""
    if isinstance(payload, dict):
        sport = str(payload.get("sport") or "")
        data = payload.get("data")
        if not sport and isinstance(data, dict):
            sport = str(data.get("sport") or "")
    text = f"{sport} {path}".lower()
    if "nhl" in text:
        return "nhl"
    return "nfl"


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


def _push_pct(record):
    """Push probability at a whole-number count line, as a percent string."""
    books = _books(record)
    if not books:
        return "—"
    fair_over, _fair_under, _source, _names = _fair_probs(books)
    push = push_probability(fair_over, record.get("matched_line"), record.get("pp_line"), record.get("prop"))
    if push is None:
        return "—"
    return f"{pct(push):.1f}"


def _fmt(value):
    if value is None or value == "":
        return "—"
    if isinstance(value, float):
        return f"{value:.1f}"
    return str(value)


def _published_order(records):
    """Order build_snapshot writes. The preview tie-breaks on that order."""
    return sorted(
        records,
        key=lambda row: (
            -(row.get("pp_edge_flex") if isinstance(row.get("pp_edge_flex"), (int, float)) else -999),
            -(GRADE_RANK.get(row.get("grade")) or 0),
            row.get("player") or "",
            row.get("prop") or "",
        ),
    )


def free_preview(records, sport):
    """Rows the free PP Odds preview keeps. See PREVIEW_SOURCE."""
    picked = free_preview_pair(records, records, sport)
    return picked["before"]


def free_preview_pair(before, after, sport):
    """Before and after preview rows, from the site's selector."""
    node = shutil.which("node")
    if not node:
        raise SystemExit("node is required to select the free PP Odds preview")
    script = """
import { selectFreeSharpOddsPreview } from './kbo-props-ui/api/_dataAccess.js'
const chunks = []
for await (const chunk of process.stdin) chunks.push(chunk)
const body = JSON.parse(Buffer.concat(chunks).toString())
const pick = (rows) => selectFreeSharpOddsPreview(rows, body.sport)
process.stdout.write(JSON.stringify({
  before: pick(body.before),
  after: pick(body.after),
}))
"""
    completed = subprocess.run(
        [node, "--input-type=module", "-e", script],
        input=json.dumps({"sport": sport, "before": before, "after": after}),
        check=False,
        capture_output=True,
        text=True,
        cwd=ROOT,
    )
    if completed.returncode != 0:
        detail = (completed.stderr or completed.stdout or "free preview selection failed").strip()
        raise SystemExit(detail)
    return json.loads(completed.stdout)


def diff_records(records):
    """Return counts and the rows whose edge, fair percent, or grade changed."""
    changed = []
    exact_changed = []
    grade_changes = 0
    exact_count = 0
    nearest_count = 0
    before_rows = []
    after_rows = []
    for record in records or []:
        if not isinstance(record, dict):
            continue
        before_rows.append(record)
        exact = is_exact(record)
        if exact:
            exact_count += 1
        elif record.get("line_match") == "nearest" or (
            record.get("matched_line") is not None and record.get("pp_line") is not None and not exact
        ):
            nearest_count += 1
        fresh = recompute(record)
        after_rows.append(fresh if fresh is not None else record)
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
            "push": _push_pct(record),
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
        "before_rows": before_rows,
        "after_rows": _published_order(after_rows),
    }


def _table(rows):
    headers = (
        "player",
        "prop",
        "side",
        "pp_line",
        "matched_line",
        "push",
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


def _preview_table(rows):
    headers = ("player", "prop", "side", "edge")
    display = []
    for row in rows:
        edge = row.get("edge")
        display.append(
            {
                "player": str(row.get("player") or ""),
                "prop": str(row.get("prop") or ""),
                "side": str(row.get("side") or "—"),
                "edge": f"{float(edge):.1f}" if isinstance(edge, (int, float)) and not isinstance(edge, bool) else _fmt(edge),
            }
        )
    widths = {key: len(key) for key in headers}
    for row in display:
        for key in headers:
            widths[key] = max(widths[key], len(row[key]))

    def line(row):
        return "  ".join(row[key].ljust(widths[key]) for key in headers)

    body = [
        line({key: key for key in headers}),
        line({key: "-" * widths[key] for key in headers}),
    ]
    body.extend(line(row) for row in display)
    if not display:
        body.append("(none)")
    return "\n".join(body)


def render(summary, preview=None, sport="nfl"):
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
    if preview is not None:
        lines.append("")
        lines.append(f"free PP Odds preview ({sport}), sorted by pp_edge_flex")
        lines.append(PREVIEW_SOURCE)
        lines.append("before:")
        lines.append(_preview_table(preview["before"]))
        lines.append("after:")
        lines.append(_preview_table(preview["after"]))
    return "\n".join(lines)


def main(argv=None):
    parser = argparse.ArgumentParser(description="Diff a PP Odds snapshot against the current line shift")
    parser.add_argument("snapshot", type=Path, help="Local snapshot JSON (records, or a data wrapper)")
    args = parser.parse_args(argv)
    if not args.snapshot.is_file():
        raise SystemExit(f"snapshot not found: {args.snapshot}")
    payload = json.loads(args.snapshot.read_text(encoding="utf-8"))
    records = _records_from(payload)
    if records is None:
        raise SystemExit(f"{args.snapshot} has no records list")
    sport = snapshot_sport(payload, args.snapshot)
    summary = diff_records(records)
    preview = free_preview_pair(summary["before_rows"], summary["after_rows"], sport)
    print(render(summary, preview, sport))
    return 1 if summary["exact_changed"] else 0


if __name__ == "__main__":
    raise SystemExit(main())

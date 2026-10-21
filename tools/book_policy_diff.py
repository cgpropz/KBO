#!/usr/bin/env python3
"""Compare an older PP Odds snapshot with the book policy.

Prints counts to stdout. Does not write a file.

    python tools/book_policy_diff.py OLD.json NEW.json
    python tools/book_policy_diff.py OLD.json --feed unabated.json --board projections.json [--sport nfl|nhl|nba]

OLD and NEW are sharp-odds snapshots (a top-level records list, or
{"records": ...}, or {"data": {"records": ...}}). With --feed and --board,
NEW is rebuilt in memory with the current snapshot code. Nothing is written.

A row is a books-count change when matched_books_count or fair_book_count
differs. CG odds is the American price from the CG odds column (flex
break-even), with the book policy off on the old row and on for the new
row. PP Edge is pp_edge_flex. Grade is the stored grade. The mover list is
the ten largest |PP Edge| changes among rows in both snapshots.
"""
from __future__ import annotations

import argparse
import contextlib
import io
import json
import subprocess
import sys
import tempfile
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from nfl.sharp_odds import (  # noqa: E402
    build_snapshot,
    filter_standard_lines,
    load_pp_rows,
    name_key,
    normalize_unabated_payload,
)

FLEX_BREAKEVEN = 119 / 219
CG_MODULE = ROOT / "kbo-props-ui" / "src" / "nfl" / "cgOdds.js"


def load_payload(path):
    return json.loads(Path(path).read_text(encoding="utf-8"))


def records_from(payload):
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


def snapshot_sport(payload):
    sport = ""
    if isinstance(payload, dict):
        sport = str(payload.get("sport") or "")
        data = payload.get("data")
        if not sport and isinstance(data, dict):
            sport = str(data.get("sport") or "")
    text = sport.lower()
    if "nba" in text or "basketball" in text:
        return "nba"
    if "nhl" in text or "hockey" in text:
        return "nhl"
    return "nfl"


def recompute_snapshot(feed_path, board_path, sport):
    payload = load_payload(feed_path)
    board = Path(board_path)
    feed_at = payload.get("snapshotStartedAtUtc") if isinstance(payload, dict) else None
    if sport == "nhl":
        from nhl.sharp_odds import board_rows, normalize_nhl_payload

        books, events = normalize_nhl_payload(payload)
        with contextlib.redirect_stdout(io.StringIO()):
            pp_rows = load_pp_rows(board) or []
        projections = json.loads(board.read_text(encoding="utf-8"))
        ranked, line_type_filter = board_rows(pp_rows, projections if isinstance(projections, list) else [])
        snapshot = build_snapshot(
            ranked,
            books,
            provider="unabated",
            events_scanned=events,
            feed_snapshot_at=feed_at,
            line_type_filter=line_type_filter,
        )
        snapshot["sport"] = "nhl"
        return snapshot
    if sport == "nba":
        try:
            import nba.sharp_odds as nba
        except ImportError as exc:
            raise SystemExit("NBA sharp odds are not in this checkout. Pass a new snapshot JSON instead.") from exc
        books, events = nba.normalize_nba_payload(payload)
        pp_rows = nba.load_nba_pp_rows(board)
        if pp_rows is None:
            raise SystemExit(f"No NBA board at {board}")
        return nba.snapshot_from_rows(pp_rows, books, events_scanned=events, feed_snapshot_at=feed_at)
    books, events = normalize_unabated_payload(payload)
    with contextlib.redirect_stdout(io.StringIO()):
        pp_rows = load_pp_rows(board)
    if pp_rows is None:
        raise SystemExit(f"No board at {board}")
    pp_rows, line_type_filter = filter_standard_lines(pp_rows)
    return build_snapshot(
        pp_rows,
        books,
        provider="unabated",
        events_scanned=events,
        feed_snapshot_at=feed_at,
        line_type_filter=line_type_filter,
    )


def row_key(row):
    if not isinstance(row, dict):
        return ""
    player = row.get("player_key") or name_key(row.get("player"))
    prop = str(row.get("prop") or "")
    line = row.get("pp_line")
    try:
        line_text = f"{float(line):.1f}"
    except (TypeError, ValueError):
        line_text = ""
    return f"{player}|{prop}|{line_text}"


def index_rows(records):
    indexed = {}
    for row in records or []:
        if isinstance(row, dict):
            indexed[row_key(row)] = row
    return indexed


def _number(value):
    if isinstance(value, bool) or value is None or value == "":
        return None
    try:
        return float(value)
    except (TypeError, ValueError):
        return None


def _same_number(left, right):
    if left is None and right is None:
        return True
    if left is None or right is None:
        return False
    return abs(left - right) < 1e-9


def _side(row):
    recommendation = str((row or {}).get("recommendation") or "").upper()
    if recommendation == "UNDER":
        return "under"
    if recommendation == "OVER":
        return "over"
    return None


def _cg_requests(indexed, apply_policy):
    requests = []
    for key, row in indexed.items():
        side = _side(row)
        if side is None:
            continue
        requests.append(
            {
                "key": key,
                "side": side,
                "breakeven": FLEX_BREAKEVEN,
                "applyBookPolicy": apply_policy,
                "item": {
                    "prop": row.get("prop"),
                    "pp_line": row.get("pp_line"),
                    "matched_line": row.get("matched_line"),
                    "book_prices": row.get("book_prices") if isinstance(row.get("book_prices"), list) else [],
                },
            }
        )
    return requests


def cg_americans(indexed, apply_policy):
    requests = _cg_requests(indexed, apply_policy)
    if not requests:
        return {}
    program = (
        "import { computeCgOdds } from " + json.dumps(CG_MODULE.as_uri()) + ";\n"
        "const chunks = [];\n"
        "for await (const chunk of process.stdin) chunks.push(chunk);\n"
        "const rows = JSON.parse(Buffer.concat(chunks).toString() || '[]');\n"
        "const out = rows.map((row) => {\n"
        "  const cg = computeCgOdds(row.item, row.side, row.breakeven, { applyBookPolicy: row.applyBookPolicy });\n"
        "  return { key: row.key, american: cg ? cg.american : null };\n"
        "});\n"
        "process.stdout.write(JSON.stringify(out));\n"
    )
    with tempfile.NamedTemporaryFile("w", suffix=".mjs", delete=False) as handle:
        handle.write(program)
        script_path = handle.name
    try:
        completed = subprocess.run(
            ["node", script_path],
            input=json.dumps(requests),
            text=True,
            capture_output=True,
            check=False,
        )
    finally:
        Path(script_path).unlink(missing_ok=True)
    if completed.returncode != 0:
        detail = (completed.stderr or completed.stdout or "").strip()
        raise SystemExit(f"CG odds comparison failed: {detail}")
    parsed = json.loads(completed.stdout or "[]")
    return {row["key"]: row.get("american") for row in parsed}


def _books_changed(old, new):
    old = old or {}
    new = new or {}
    matched = not _same_number(_number(old.get("matched_books_count")), _number(new.get("matched_books_count")))
    fair = not _same_number(_number(old.get("fair_book_count")), _number(new.get("fair_book_count")))
    return matched or fair


def _edge(row):
    if not row:
        return None
    return _number(row.get("pp_edge_flex"))


def _grade(row):
    if not row:
        return None
    grade = row.get("grade")
    if grade is None or grade == "":
        return None
    return str(grade)


def _fmt_edge(value):
    if value is None:
        return "—"
    return f"{value:.1f}"


def report(old_records, new_records):
    old_index = index_rows(old_records)
    new_index = index_rows(new_records)
    keys = sorted(set(old_index) | set(new_index))
    old_cg = cg_americans(old_index, False)
    new_cg = cg_americans(new_index, True)
    books_changed = 0
    cg_changed = 0
    edge_changed = 0
    grade_changed = 0
    movers = []
    for key in keys:
        old = old_index.get(key)
        new = new_index.get(key)
        if _books_changed(old, new):
            books_changed += 1
        if old_cg.get(key) != new_cg.get(key):
            cg_changed += 1
        old_edge = _edge(old)
        new_edge = _edge(new)
        if not _same_number(old_edge, new_edge):
            edge_changed += 1
            if old is not None and new is not None:
                if old_edge is None:
                    delta = abs(new_edge)
                elif new_edge is None:
                    delta = abs(old_edge)
                else:
                    delta = abs(new_edge - old_edge)
                label = new or old
                movers.append(
                    (
                        delta,
                        str(label.get("player") or ""),
                        str(label.get("prop") or ""),
                        str(label.get("recommendation") or "—"),
                        old_edge,
                        new_edge,
                    )
                )
        if _grade(old) != _grade(new):
            grade_changed += 1
    movers.sort(key=lambda item: (-item[0], item[1], item[2], item[3]))
    lines = [
        f"books_count_changed {books_changed}",
        f"cg_odds_changed {cg_changed}",
        f"pp_edge_changed {edge_changed}",
        f"grade_changed {grade_changed}",
        f"top_pp_edge_movers {min(10, len(movers))}",
    ]
    for index, (delta, player, prop, side, old_edge, new_edge) in enumerate(movers[:10], start=1):
        lines.append(
            f"{index}\t{player}\t{prop}\t{side}\t{_fmt_edge(old_edge)} -> {_fmt_edge(new_edge)}\tabs {delta:.1f}"
        )
    return "\n".join(lines)


def main(argv=None):
    parser = argparse.ArgumentParser(description="Print PP Odds book-policy diffs. Writes nothing.")
    parser.add_argument("old", type=Path, help="Snapshot from before the book policy")
    parser.add_argument("new", nargs="?", type=Path, help="Snapshot from after the book policy")
    parser.add_argument("--feed", type=Path, help="Saved Unabated props JSON. Recomputes the new snapshot in memory.")
    parser.add_argument("--board", type=Path, help="Saved PrizePicks board used with --feed")
    parser.add_argument("--sport", choices=("nfl", "nhl", "nba"), help="Sport for --feed. Defaults from the old snapshot.")
    args = parser.parse_args(argv)
    if args.feed or args.board:
        if args.new is not None:
            parser.error("Pass either a new snapshot or --feed and --board, not both.")
        if not args.feed or not args.board:
            parser.error("--feed and --board are both required to recompute.")
    elif args.new is None:
        parser.error("Pass a new snapshot, or --feed and --board.")
    old_payload = load_payload(args.old)
    old_records = records_from(old_payload)
    if old_records is None:
        raise SystemExit(f"{args.old} has no records list")
    if args.feed:
        sport = args.sport or snapshot_sport(old_payload)
        new_payload = recompute_snapshot(args.feed, args.board, sport)
        new_records = records_from(new_payload) or []
    else:
        new_payload = load_payload(args.new)
        new_records = records_from(new_payload)
        if new_records is None:
            raise SystemExit(f"{args.new} has no records list")
    print(report(old_records, new_records))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

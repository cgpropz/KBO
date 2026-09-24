#!/usr/bin/env python3
"""Rebuild summary.json from an existing recap.json (or graded props JSON).

Normally summary.json is written automatically by grade_{kbo,wnba,nfl}_day
via common.write_recap / write_partial_progress. This CLI is for backfill or
smoke checks without re-running live actuals.
"""
from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[2]))

from pipeline.memory.common import (
    SPORTS,
    load_json,
    memory_dir,
    parse_cli_date,
    today_et,
    write_day_summary,
)


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(
        description="Write memory/<sport>/mm/dd/yyyy/summary.json from recap.json"
    )
    parser.add_argument("--sport", required=True, choices=SPORTS)
    parser.add_argument("--date", required=True, help="mm/dd/YYYY or YYYY-MM-DD")
    parser.add_argument(
        "--from-recap",
        action="store_true",
        default=True,
        help="Load props from recap.json (default)",
    )
    parser.add_argument(
        "--props-json",
        help="Optional path to a JSON list of graded props (overrides recap)",
    )
    parser.add_argument(
        "--status",
        choices=("complete", "partial"),
        default=None,
        help="Override summary status (default: complete if from recap, else partial)",
    )
    parser.add_argument("--dry-run", action="store_true")
    args = parser.parse_args(argv)

    d = parse_cli_date(args.date, today_et())
    day_dir = memory_dir(args.sport, d)

    if args.props_json:
        props = load_json(Path(args.props_json), default=[]) or []
        if isinstance(props, dict):
            props = props.get("props") or []
        status = args.status or "partial"
        props_total = len(props)
    else:
        recap = load_json(day_dir / "recap.json")
        if not recap or not recap.get("props"):
            print(
                json.dumps(
                    {
                        "error": "no recap.json props",
                        "path": str(day_dir / "recap.json"),
                    },
                    indent=2,
                ),
                file=sys.stderr,
            )
            return 1
        props = recap["props"]
        status = args.status or "complete"
        meta = load_json(day_dir / "meta.json", default={}) or {}
        props_total = int(meta.get("props_total") or len(props))

    summary = None
    if args.dry_run:
        from pipeline.memory.common import build_day_summary

        summary = build_day_summary(
            args.sport, d, props, status=status, props_total=props_total
        )
        path = day_dir / "summary.json"
    else:
        path, summary = write_day_summary(
            args.sport, d, props, status=status, props_total=props_total
        )

    print(
        json.dumps(
            {
                "path": str(path),
                "dry_run": args.dry_run,
                "status": summary["status"],
                "props_graded": summary["props_graded"],
                "hits": summary["hits"],
                "misses": summary["misses"],
                "pushes": summary["pushes"],
                "dnps": summary["dnps"],
                "hit_rate": summary["hit_rate"],
                "hit_rate_pct": summary["hit_rate_pct"],
            },
            indent=2,
        )
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

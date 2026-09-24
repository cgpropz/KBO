#!/usr/bin/env python3
"""Check whether a memory day is ready to write recap.json (exit 0 = complete-eligible)."""
from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[2]))

from pipeline.memory.common import load_json, memory_dir, parse_cli_date, today_et, yesterday_kst
from pipeline.memory import grade_kbo_day, grade_nfl_day, grade_wnba_day


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Verify finals gate for a memory day")
    parser.add_argument("--sport", choices=("kbo", "wnba", "nfl"), required=True)
    parser.add_argument("--date", help="mm/dd/YYYY or YYYY-MM-DD")
    args = parser.parse_args(argv)

    if args.sport == "kbo":
        d = parse_cli_date(args.date, yesterday_kst())
        result = grade_kbo_day.grade_day(d, dry_run=True)
    elif args.sport == "wnba":
        from datetime import timedelta

        d = parse_cli_date(args.date, today_et() - timedelta(days=1))
        result = grade_wnba_day.grade_day(d, dry_run=True)
    else:
        from datetime import timedelta

        today = today_et()
        default = today - timedelta(days=(today.weekday() - 6) % 7)
        d = parse_cli_date(args.date, default)
        result = grade_nfl_day.grade_day(d, dry_run=True)

    print(json.dumps(result, indent=2))
    return 0 if result.get("status") == "complete" else 1


if __name__ == "__main__":
    raise SystemExit(main())

"""
Fill sport on saved slips that were stored before the column existed.

Dry-run prints counts only. It does not print slip ids, user ids, or emails.
Do not run this against production until sql/migrations/20261017_saved_slips_sport.sql
has been applied. This script does not apply that migration.

  python backfill_saved_slip_sport.py --dry-run
  python backfill_saved_slip_sport.py
"""
from __future__ import annotations

import argparse
import sys

from pipeline.saved_slip_db import missing_sport_column, supabase_client
from pipeline.saved_slip_grade import FETCH_LIMIT
from pipeline.saved_slip_sport import format_sport_counts, plan_sport_updates

MIGRATION = "sql/migrations/20261017_saved_slips_sport.sql"


def fetch_slips(sb, limit: int) -> tuple[list, bool]:
    rows = []
    start = 0
    columns = "id,legs,sport,game_date"
    missing = False
    while start < limit * 50:
        try:
            resp = (
                sb.table("saved_slips")
                .select(columns)
                .order("id")
                .range(start, start + limit - 1)
                .execute()
            )
        except Exception as exc:
            if columns != "id,legs,game_date" and missing_sport_column(exc):
                columns = "id,legs,game_date"
                missing = True
                continue
            raise
        batch = list(resp.data or [])
        rows.extend(batch)
        if len(batch) < limit:
            break
        start += limit
    return rows, missing


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Backfill saved_slips.sport from prop names and team codes")
    parser.add_argument("--dry-run", action="store_true", help="Print counts only. Do not update rows.")
    parser.add_argument("--limit", type=int, default=FETCH_LIMIT)
    args = parser.parse_args(argv)
    try:
        sb = supabase_client()
        slips, missing = fetch_slips(sb, max(1, args.limit))
        updates, counts = plan_sport_updates(slips)
        print(format_sport_counts(counts, dry_run=args.dry_run))
        if missing:
            print(f"sport column is missing. Apply {MIGRATION} first. No rows were updated.")
            return 0 if args.dry_run else 1
        if args.dry_run:
            return 0
        for slip_id, sport in updates:
            sb.table("saved_slips").update({"sport": sport}).eq("id", slip_id).is_("sport", "null").execute()
        print(f"saved slip sport updated={len(updates)}")
    except SystemExit:
        raise
    except Exception as exc:  # noqa: BLE001
        print(f"saved slip sport backfill failed: {type(exc).__name__}")
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

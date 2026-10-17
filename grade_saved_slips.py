"""
Grade saved subscriber slips against final games.

KBO, NFL, WNBA, and NHL use the same stat sources as the day graders.
Slips for any other sport stay ungraded. A scratched, OUT, DNP, or voided
leg counts as a push. The publish step keeps going when some slips cannot
be graded; the summary prints could_not_grade.

Results are written only to saved_slips. They are subscriber entries and are
not passed to compute_hit_rate_stats or write_recap, which are what publish
the public hit rates.

  python grade_saved_slips.py
  python grade_saved_slips.py --dry-run
  python backfill_saved_slip_grades.py --dry-run
  python backfill_saved_slip_grades.py
  python backfill_saved_slip_grades.py --regrade --dry-run
"""
from __future__ import annotations

import argparse

from pipeline.memory.common import today_et
from pipeline.saved_slip_db import supabase_client
from pipeline.saved_slip_grade import FETCH_LIMIT, LiveSources, format_summary, grade_batch
from pipeline.saved_slip_sport import legs_of


def already_ungradeable(slip: dict) -> bool:
    """A slip whose every leg was already marked ungradeable is not retried."""
    legs = [leg for leg in legs_of(slip) if isinstance(leg, dict)]
    return bool(legs) and all(leg.get("ungradeable") for leg in legs)


def fetch_pages(build, limit: int) -> list:
    """Page a fresh query until a short page or 50 pages."""
    rows = []
    start = 0
    page = max(1, limit)
    while start < page * 50:
        resp = build().range(start, start + page - 1).execute()
        batch = list(getattr(resp, "data", None) or [])
        rows.extend(batch)
        if len(batch) < page:
            break
        start += page
    return rows


def fetch_ungraded(sb, today, limit: int) -> list:
    """Ungraded slips before today, plus today, paged past the first page.

    Slips already marked ungradeable are skipped so they cannot fill the window.
    """
    iso = today.isoformat()

    def past():
        return (
            sb.table("saved_slips")
            .select("*")
            .eq("graded", False)
            .lt("game_date", iso)
            .order("game_date")
            .order("id")
        )

    def current():
        return (
            sb.table("saved_slips")
            .select("*")
            .eq("graded", False)
            .eq("game_date", iso)
            .order("id")
        )

    rows = fetch_pages(past, limit) + fetch_pages(current, limit)
    return [row for row in rows if not already_ungradeable(row)]


def fetch_past(sb, today, limit: int) -> list:
    """Every slip from before today, including graded rows. Opt-in via --regrade."""
    def past():
        return (
            sb.table("saved_slips")
            .select("*")
            .lt("game_date", today.isoformat())
            .order("id")
        )

    return fetch_pages(past, limit)


def apply_updates(sb, updates, summary) -> None:
    for update in updates:
        try:
            sb.table("saved_slips").update(update["payload"]).eq("id", update["id"]).execute()
        except Exception:  # noqa: BLE001 - one row must not abort the publish
            summary["could_not_grade"] = summary.get("could_not_grade", 0) + 1


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Grade saved slips for KBO, NFL, WNBA, and NHL")
    parser.add_argument("--dry-run", action="store_true", help="Print counts only. Do not update rows.")
    parser.add_argument(
        "--regrade",
        action="store_true",
        help="Opt-in. Also read slips that already have a result. A graded slip is not moved to pending, ungradeable, or a void caused by missing data.",
    )
    parser.add_argument("--limit", type=int, default=FETCH_LIMIT, help=f"Rows per fetch (default {FETCH_LIMIT}).")
    args = parser.parse_args(argv)
    limit = max(1, args.limit)

    try:
        sb = supabase_client()
        today = today_et()
        slips = fetch_past(sb, today, limit) if args.regrade else fetch_ungraded(sb, today, limit)
        sources = LiveSources()
        updates, summary = grade_batch(slips, sources, today)
        if sources.notes:
            summary["source_notes"] = sources.notes
        if not args.dry_run:
            apply_updates(sb, updates, summary)
        print(format_summary(summary, dry_run=args.dry_run))
    except SystemExit:
        raise
    except Exception as exc:  # noqa: BLE001 - publish must continue
        print(f"saved slip grading failed: {type(exc).__name__}")
        print("could_not_grade=1")
        return 0
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

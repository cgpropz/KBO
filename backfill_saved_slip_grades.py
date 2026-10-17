"""
Re-grade saved slips dated before today.

Dry-run prints counts only. It does not print slip ids, user ids, or emails.
Do not run this against production from the publish job. Run it after midnight ET,
after the sport migration, when you want old slips graded again.

  python backfill_saved_slip_grades.py --dry-run
  python backfill_saved_slip_grades.py
"""
from __future__ import annotations

import sys

from grade_saved_slips import main

if __name__ == "__main__":
    argv = sys.argv[1:]
    if "--regrade" not in argv:
        argv = ["--regrade", *argv]
    raise SystemExit(main(argv))

"""
Grade saved slips that are still ungraded.

The default reads graded=false only, paged. --regrade is opt-in. It will not
move a graded=true slip to pending, to ungradeable, or to a void caused by
missing data.

Dry-run prints counts only, including from→to changes. It does not print slip
ids, user ids, or emails. Do not run this against production from the publish
job. Run it after midnight ET, after the sport migration, when you want old
ungraded slips graded.

  python backfill_saved_slip_grades.py --dry-run
  python backfill_saved_slip_grades.py
  python backfill_saved_slip_grades.py --regrade --dry-run
"""
from __future__ import annotations

from grade_saved_slips import main

if __name__ == "__main__":
    raise SystemExit(main())

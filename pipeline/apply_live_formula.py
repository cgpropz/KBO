#!/usr/bin/env python3
"""Apply pipeline/projection_formula.json to exported WNBA boards.

KBO and NFL apply the same switch inside their generators
(generate_projections.py, generate_batter_projections.py, nfl/build_projection_data.py).
WNBA projections are computed in Node and exported to JSON, so this step
rewrites those snapshots before they are published.

    python3 pipeline/apply_live_formula.py --sport wnba
"""
from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from pipeline.live_formula import apply_wnba_files, formula_mode  # noqa: E402


def main(argv=None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--sport", choices=("wnba",), default="wnba")
    parser.add_argument("--dir", type=Path, default=None, help="WNBA snapshot directory")
    args = parser.parse_args(argv)
    summary = apply_wnba_files(args.dir)
    summary["mode"] = formula_mode("wnba")
    print(json.dumps(summary, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

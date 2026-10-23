#!/usr/bin/env python3
"""One-off cleanup: drop the demon Pass TDs rows frozen into the 10/25 and
10/26/2026 NFL slates.

Before #388, choose_published_line put the 1.5/2.5 Pass TDs demon card on the
board when a quarterback had no standard line, and freeze_slate.py labeled
every NFL row odds_type "standard". merge_slate_props keeps existing rows, so
those cards stayed in the two slates frozen before the fix. Every board grades
standard PrizePicks lines only, so they come out.

Each row below was checked against the PrizePicks partner API projections
(league 9, pulled 2026-10-23 21:07 UTC): the frozen projection_id is a
pre_game card with odds_type "demon", the same player, stat_type "Pass TDs"
and line, and that player has no standard Pass TDs card posted. The six Pass
TDs rows whose frozen id is a standard card (Rodgers, Jones, McCarthy, Goff,
Cousins, L. Jackson) stay.

A row is dropped only when player, stat, line and projection_id all match, so
re-running is a no-op. Usage: python -m pipeline.memory.drop_nfl_nonstandard_slate_rows
"""
from __future__ import annotations

import sys
from datetime import date
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[2]))

from pipeline.memory import common

# (slate date, player, line, PrizePicks projection id): Pass TDs, odds_type demon.
DEMON_PASS_TDS = (
    ("2026-10-25", "Baker Mayfield", 1.5, "16029217"),
    ("2026-10-25", "Bo Nix", 1.5, "15956078"),
    ("2026-10-25", "Brock Purdy", 2.5, "15998317"),
    ("2026-10-25", "Bryce Young", 2.5, "15945235"),
    ("2026-10-25", "C.J. Stroud", 2.5, "16007419"),
    ("2026-10-25", "Cam Ward", 1.5, "15955149"),
    ("2026-10-25", "Deshaun Watson", 1.5, "15963346"),
    ("2026-10-25", "Geno Smith", 1.5, "15944270"),
    ("2026-10-25", "Jacoby Brissett", 1.5, "15956074"),
    ("2026-10-25", "Joe Burrow", 2.5, "16008170"),
    ("2026-10-25", "Jordan Love", 2.5, "15959790"),
    ("2026-10-25", "Kyler Murray", 1.5, "15943208"),
    ("2026-10-25", "Malik Willis", 1.5, "15944372"),
    ("2026-10-25", "Matthew Stafford", 2.5, "15985953"),
    ("2026-10-25", "Michael Penix Jr.", 1.5, "16014276"),
    ("2026-10-25", "Patrick Mahomes", 1.5, "15942243"),
    ("2026-10-25", "Sam Darnold", 1.5, "15942207"),
    ("2026-10-25", "Tyler Shough", 1.5, "15940718"),
    ("2026-10-26", "Dak Prescott", 2.5, "15966206"),
    ("2026-10-26", "Tanner McKee", 1.5, "15966227"),
)


def drop_rows(props: list[dict], slate_iso: str, evidence=DEMON_PASS_TDS) -> tuple[list[dict], list[dict]]:
    """Return (kept, dropped) for one slate's props."""
    targets = {(name, float(line), str(pid)) for day, name, line, pid in evidence if day == slate_iso}
    kept, dropped = [], []
    for prop in props:
        key = (prop.get("player"), float(prop.get("line") or 0), str(prop.get("projection_id") or ""))
        if prop.get("stat") == "Pass TDs" and key in targets:
            dropped.append(prop)
        else:
            kept.append(prop)
    return kept, dropped


def clean_slate(day: date, root: Path | None = None) -> int:
    base = (root / "nfl" / day.strftime("%m") / day.strftime("%d") / day.strftime("%Y")) if root else common.memory_dir("nfl", day)
    slate_path = base / "slate.json"
    slate = common.load_json(slate_path)
    kept, dropped = drop_rows(slate.get("props") or [], day.isoformat())
    if not dropped:
        return 0
    slate["props"] = kept
    common.save_json(slate_path, slate)
    meta_path = base / "meta.json"
    if meta_path.exists():
        meta = common.load_json(meta_path) or {}
        if "props_total" in meta:
            meta["props_total"] = len(kept)
            common.save_json(meta_path, meta)
    return len(dropped)


def main() -> None:
    for day in sorted({date.fromisoformat(d) for d, *_ in DEMON_PASS_TDS}):
        print(day.isoformat(), "dropped", clean_slate(day))


if __name__ == "__main__":
    main()

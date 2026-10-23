#!/usr/bin/env python3
"""One-off cleanup: drop the non-standard (demon/goblin) rows frozen into the
10/25 and 10/26/2026 NFL slates.

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

Four 10/25 Receptions rows were frozen the same way: two demon cards (Pitts
3.5, Judkins 2.5) and two goblin cards (Meyers 1.5, Jacobs 1.5). Board QA
checked them against the partner API; none of those players has a standard
Receptions card, so they come out too.

A row is dropped only when player, stat, line and projection_id all match
(whether or not a later freeze already marked it removed), so
re-running is a no-op. Usage: python -m pipeline.memory.drop_nfl_nonstandard_slate_rows
"""
from __future__ import annotations

import sys
from datetime import date
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[2]))

from pipeline.memory import common

# (slate date, player, stat, line, PrizePicks projection id, odds_type).
NONSTANDARD_ROWS = (
    ("2026-10-25", "Baker Mayfield", "Pass TDs", 1.5, "16029217", "demon"),
    ("2026-10-25", "Bo Nix", "Pass TDs", 1.5, "15956078", "demon"),
    ("2026-10-25", "Brock Purdy", "Pass TDs", 2.5, "15998317", "demon"),
    ("2026-10-25", "Bryce Young", "Pass TDs", 2.5, "15945235", "demon"),
    ("2026-10-25", "C.J. Stroud", "Pass TDs", 2.5, "16007419", "demon"),
    ("2026-10-25", "Cam Ward", "Pass TDs", 1.5, "15955149", "demon"),
    ("2026-10-25", "Deshaun Watson", "Pass TDs", 1.5, "15963346", "demon"),
    ("2026-10-25", "Geno Smith", "Pass TDs", 1.5, "15944270", "demon"),
    ("2026-10-25", "Jacoby Brissett", "Pass TDs", 1.5, "15956074", "demon"),
    ("2026-10-25", "Joe Burrow", "Pass TDs", 2.5, "16008170", "demon"),
    ("2026-10-25", "Jordan Love", "Pass TDs", 2.5, "15959790", "demon"),
    ("2026-10-25", "Kyler Murray", "Pass TDs", 1.5, "15943208", "demon"),
    ("2026-10-25", "Malik Willis", "Pass TDs", 1.5, "15944372", "demon"),
    ("2026-10-25", "Matthew Stafford", "Pass TDs", 2.5, "15985953", "demon"),
    ("2026-10-25", "Michael Penix Jr.", "Pass TDs", 1.5, "16014276", "demon"),
    ("2026-10-25", "Patrick Mahomes", "Pass TDs", 1.5, "15942243", "demon"),
    ("2026-10-25", "Sam Darnold", "Pass TDs", 1.5, "15942207", "demon"),
    ("2026-10-25", "Tyler Shough", "Pass TDs", 1.5, "15940718", "demon"),
    ("2026-10-26", "Dak Prescott", "Pass TDs", 2.5, "15966206", "demon"),
    ("2026-10-26", "Tanner McKee", "Pass TDs", 1.5, "15966227", "demon"),
    ("2026-10-25", "Kyle Pitts Sr.", "Receptions", 3.5, "15998485", "demon"),
    ("2026-10-25", "Quinshon Judkins", "Receptions", 2.5, "16084085", "demon"),
    ("2026-10-25", "Dohnte Meyers", "Receptions", 1.5, "16089245", "goblin"),
    ("2026-10-25", "Josh Jacobs", "Receptions", 1.5, "16053776", "goblin"),
)


def drop_rows(props: list[dict], slate_iso: str, evidence=NONSTANDARD_ROWS) -> tuple[list[dict], list[dict]]:
    """Return (kept, dropped) for one slate's props."""
    targets = {(name, stat, float(line), str(pid)) for day, name, stat, line, pid, _odds in evidence if day == slate_iso}
    kept, dropped = [], []
    for prop in props:
        key = (prop.get("player"), prop.get("stat"), float(prop.get("line") or 0), str(prop.get("projection_id") or ""))
        if key in targets:
            dropped.append(prop)
        else:
            kept.append(prop)
    return kept, dropped


def slate_dir(day: date, root: Path | None = None) -> Path:
    return (root / "nfl" / day.strftime("%m") / day.strftime("%d") / day.strftime("%Y")) if root else common.memory_dir("nfl", day)


def clean_slate(day: date, root: Path | None = None) -> int:
    base = slate_dir(day, root)
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
    for day in sorted({date.fromisoformat(d) for d, *_ in NONSTANDARD_ROWS}):
        slate = common.load_json(slate_dir(day) / "slate.json") or {}
        _, matched = drop_rows(slate.get("props") or [], day.isoformat())
        already = sum(1 for p in matched if p.get("removed"))
        before = len(slate.get("props") or [])
        n = clean_slate(day)
        print(f"{day.isoformat()} dropped {n} (already marked removed {already}, live {n - already}); props {before} -> {before - n}")


if __name__ == "__main__":
    main()

#!/usr/bin/env python3
"""Re-join AGS CSVs against athlete_cache.json (offline, no network).

For each data/YYYY-MM-DD_ags.csv, writes data/YYYY-MM-DD_ags.fixed.csv next to it
(the original is never touched). Only rows whose player is an athlete_<id>
placeholder, or whose pos/team is blank, are filled; every other value and the
header stay exactly as they were. The team is filled only when the cached team
is one of the two teams in that row's game (e.g. CBJ@MIN); otherwise it stays
blank. Team id -> abbreviation is learned from the CSVs' own filled rows, so the
abbreviations match the scoreboard's (e.g. UTA, not UTAH).

    python rejoin.py [--data DIR] [--cache athlete_cache.json]
"""
import argparse, csv, glob, json, os

BASE = os.path.dirname(os.path.abspath(__file__))


def needs_fix(row):
    return row["player"].startswith("athlete_") or not row["player"] or not row["pos"] or not row["team"]


def learn_team_abbr(paths, cache):
    abbr = {}
    for path in paths:
        with open(path, newline="") as fh:
            for row in csv.DictReader(fh):
                c = cache.get(row["athlete_id"]) or {}
                if row["team"] and c.get("team_id") and not needs_fix(row):
                    abbr.setdefault(c["team_id"], row["team"])
    return abbr


def rejoin(data_dir, cache_path):
    cache = json.load(open(cache_path))
    paths = sorted(p for p in glob.glob(os.path.join(data_dir, "*_ags.csv")))
    abbr = learn_team_abbr(paths, cache)
    report = []
    for path in paths:
        with open(path, newline="") as fh:
            reader = csv.DictReader(fh)
            header = reader.fieldnames
            rows = list(reader)
        fixed = left = 0
        for row in rows:
            if not needs_fix(row):
                continue
            c = cache.get(row["athlete_id"]) or {}
            if c.get("name") and not str(c["name"]).startswith("athlete_") and (row["player"].startswith("athlete_") or not row["player"]):
                row["player"] = c["name"]
            if not row["pos"] and c.get("pos"):
                row["pos"] = c["pos"]
            team = abbr.get(c.get("team_id") or "")
            if not row["team"] and team and team in row["game"].split("@"):
                row["team"] = team
            if needs_fix(row):
                left += 1
            else:
                fixed += 1
        out = path[: -len(".csv")] + ".fixed.csv"
        with open(out, "w", newline="") as fh:
            w = csv.DictWriter(fh, fieldnames=header)
            w.writeheader()
            w.writerows(rows)
        report.append((os.path.basename(out), len(rows), fixed, left))
    return report


def main():
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument("--data", default=os.path.join(BASE, "data"))
    ap.add_argument("--cache", default=os.path.join(BASE, "athlete_cache.json"))
    args = ap.parse_args()
    for name, total, fixed, left in rejoin(args.data, args.cache):
        print(f"{name}: {total} rows, {fixed} fixed, {left} still incomplete")


if __name__ == "__main__":
    main()

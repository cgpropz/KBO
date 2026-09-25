#!/usr/bin/env python3
"""Rebuild the KBO historical dataset: pregame projections + PrizePicks lines
reconstructed from git history of the live snapshot files, joined to actuals.

    python3 -m ml.kbo.build_dataset [--ref HEAD] [--out ml/out]

Sources (all read at --ref, so a pinned ref gives a byte-identical dataset):
  kbo-props-ui/public/data/strikeout_projections.json   pitcher projections + lines (git history)
  kbo-props-ui/public/data/batter_projections.json      batter projections + lines (git history)
  Batters-Data/KBO_daily_batting_stats_combined.csv     batter actuals
  Pitchers-Data/pitcher_logs.json                       pitcher actuals

Pregame rule: for KST game date D take the LAST commit of each snapshot file
with committer time in [D-1 05:00 UTC, D 05:00 UTC) (D 05:00 UTC = 14:00 KST,
the earliest KBO first pitch). A row is kept only if the player's own box score
exists on D for the same team AND opponent (guards stale slates). Batter rows
whose recent_game_log already contains D are dropped (leakage guard).

Outputs: <out>/kbo_dataset.csv and <out>/kbo_dataset_stats.json
"""
from __future__ import annotations

import argparse
import csv
import io
import json
import sys
from collections import defaultdict
from datetime import datetime, timezone
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[2]))

from ml.common.util import DEFAULT_OUT, REPO_ROOT, GitRepo, norm_name, parse_date, write_csv, write_json

FILES = {
    "pitcher": "kbo-props-ui/public/data/strikeout_projections.json",
    "batter": "kbo-props-ui/public/data/batter_projections.json",
}
BATTING = "Batters-Data/KBO_daily_batting_stats_combined.csv"
PITCHING = "Pitchers-Data/pitcher_logs.json"
NAME_MAPS = ("Batters-Data/prizepicks_batter_name_map.json", "Pitchers-Data/prizepicks_pitcher_name_map.json")
SEASON = 2026
PREGAME_CUTOFF_UTC_HOUR = 5  # 14:00 KST

TEAM_ALIASES = {
    "DOO": "Doosan", "DOOSAN": "Doosan", "HAN": "Hanwha", "HANWHA": "Hanwha", "KIA": "Kia",
    "KIW": "Kiwoom", "KIWOOM": "Kiwoom", "KT": "KT", "KTW": "KT", "LG": "LG", "LOT": "Lotte",
    "LOTTE": "Lotte", "NC": "NC", "NCD": "NC", "SAM": "Samsung", "SAMSUNG": "Samsung", "SSG": "SSG",
}

# Snapshot columns copied onto each row (model inputs as published).
PASSTHROUGH = (
    "games_used", "opp_factor", "park_factor", "split_factor", "pitcher_factor", "form_factor",
    "whip_factor", "whip", "so_per_ip", "ip_per_g", "hits_per_ip", "opp_so_per_g", "opp_h_per_ip",
    "avg_per_g", "projected_pa", "h_per_pa", "r_per_pa", "rbi_per_pa", "opp_pitcher_whip",
    "cg_projection", "rating", "source",
)


def canon_team(team) -> str:
    team = str(team or "").strip()
    return TEAM_ALIASES.get(team.upper(), team)


def hitter_fantasy(row: dict) -> int:
    """Site formula (SB=2), mirrors pipeline/memory/grade_kbo_day.py."""
    i = lambda k: int(float(row.get(k) or 0))
    single = max(0, i("H") - i("2B") - i("3B") - i("HR"))
    return (single * 3 + i("2B") * 5 + i("3B") * 8 + i("HR") * 10 + i("R") * 2 + i("RBI") * 2
            + i("Walks") * 2 + i("HBP") * 2 + i("SB") * 2)


def load_actuals(git: GitRepo) -> tuple[dict, dict]:
    bat: dict = {}
    for r in csv.DictReader(io.StringIO(git.file_at_ref(BATTING))):
        d = parse_date(r.get("DATE"))
        if not d or d.year != SEASON:
            continue
        i = lambda k: int(float(r.get(k) or 0))
        fs = hitter_fantasy(r)
        bat[(d, norm_name(r["Name"]))] = {
            "team": canon_team(r.get("Team")), "opp": canon_team(r.get("OPP")),
            "Hits+Runs+RBIs": i("H") + i("R") + i("RBI"), "Total Bases": i("TB"),
            "Fantasy Score": fs, "Hitter Fantasy Score": fs,
        }
    pit: dict = {}
    for r in json.loads(git.file_at_ref(PITCHING)):
        d = parse_date(r.get("Date"))
        if not d or d.year != SEASON:
            continue
        ip = float(r.get("IP") or 0)
        outs = r.get("PitOuts")
        outs = int(outs) if outs not in (None, "") else round(ip * 3)
        pit[(d, norm_name(r.get("Name")))] = {
            "team": canon_team(r.get("Tm")), "opp": canon_team(r.get("Opp")),
            "Strikeouts": float(r.get("SO") or 0), "Hits Allowed": float(r.get("HA") or 0),
            "Pitching Outs": outs,
        }
    return bat, pit


def load_name_map(git: GitRepo) -> dict:
    out = {}
    for path in NAME_MAPS:
        try:
            mapping = json.loads(git.file_at_ref(path)).get("map", {})
        except Exception:
            continue
        out.update({norm_name(k): norm_name(v) for k, v in mapping.items()})
    return out


def snapshot_context(payload: dict, row: dict) -> dict:
    """Opponent/league context as of the snapshot (used by the formula replay)."""
    opp = canon_team(row.get("opponent"))
    team_so = (payload.get("team_so_per_g") or {}) if isinstance(payload, dict) else {}
    team_h = (payload.get("team_h_per_ip") or {}) if isinstance(payload, dict) else {}
    return {
        "ctx_opp_so_per_g": team_so.get(opp, row.get("opp_so_per_g")),
        "ctx_opp_h_per_ip": team_h.get(opp, row.get("opp_h_per_ip")),
        "ctx_league_avg_so_per_g": payload.get("league_avg_so_per_g") if isinstance(payload, dict) else None,
        "ctx_league_avg_h_per_ip": payload.get("league_avg_h_per_ip") if isinstance(payload, dict) else None,
    }


def build(git: GitRepo) -> tuple[list[dict], dict]:
    bat, pit = load_actuals(git)
    nmap = load_name_map(git)
    game_days = sorted({d for d, _ in bat} | {d for d, _ in pit})
    rows: list[dict] = []
    stats: dict = defaultdict(int)
    for role, path in FILES.items():
        commits = git.commits(path)
        src = bat if role == "batter" else pit
        for day in game_days:
            cutoff = datetime(day.year, day.month, day.day, PREGAME_CUTOFF_UTC_HOUR, tzinfo=timezone.utc).timestamp()
            cand = [c for c in commits if cutoff - 86400 <= c[0] < cutoff]
            if not cand:
                stats[f"{role}_days_no_snapshot"] += 1
                continue
            ct, sha = cand[-1]
            payload = git.show_json(sha, path)
            if payload is None:
                stats[f"{role}_bad_json"] += 1
                continue
            stats[f"{role}_days_with_snapshot"] += 1
            projections = payload.get("projections", []) if isinstance(payload, dict) else payload
            for p in projections:
                line, proj = p.get("line"), p.get("projection")
                if line is None or proj is None:
                    continue
                prop = p.get("prop")
                name = p.get("name") or p.get("pp_name")
                team, opp = canon_team(p.get("team")), canon_team(p.get("opponent"))
                keys = [norm_name(name), nmap.get(norm_name(name), ""), norm_name(p.get("pp_name")),
                        nmap.get(norm_name(p.get("pp_name")), "")]
                act = next((src[(day, k)] for k in keys if k and (day, k) in src), None)
                stats[f"{role}_rows_with_line"] += 1
                if act is None:
                    stats[f"{role}_rows_no_actual"] += 1
                    continue
                if act["team"] != team or act["opp"] != opp:
                    stats[f"{role}_rows_team_opp_mismatch"] += 1
                    continue
                if role == "batter" and any(parse_date(g.get("date")) == day for g in p.get("recent_game_log") or []):
                    stats["batter_rows_leak_dropped"] += 1
                    continue
                if prop not in act:
                    stats[f"{role}_rows_unknown_prop"] += 1
                    continue
                row = {
                    "date": day.isoformat(), "role": role, "player": name, "team": team, "opp": opp,
                    "prop": prop, "odds_type": p.get("odds_type") or "unknown",
                    "line": float(line), "projection": float(proj), "recommendation": p.get("recommendation"),
                    "actual": float(act[prop]),
                }
                for key in PASSTHROUGH:
                    row[key] = p.get(key)
                if role == "pitcher":
                    row.update(snapshot_context(payload, p))
                row["commit"] = sha[:9]
                row["commit_utc"] = datetime.fromtimestamp(ct, timezone.utc).isoformat()
                row["generated_at"] = payload.get("generated_at") if isinstance(payload, dict) else None
                rows.append(row)
    stats["rows"] = len(rows)
    stats["days"] = len({r["date"] for r in rows})
    stats["ref"] = git.resolve()
    return rows, dict(stats)


def load_dataset(path: Path) -> list[dict]:
    """Read kbo_dataset.csv back with numeric columns as floats."""
    out = []
    with Path(path).open(encoding="utf-8") as handle:
        for row in csv.DictReader(handle):
            for key in ("line", "projection", "actual"):
                row[key] = float(row[key])
            out.append(row)
    return out


def main(argv=None) -> int:
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument("--repo", type=Path, default=REPO_ROOT)
    ap.add_argument("--ref", default="HEAD", help="git ref to read history and actuals at (pin for reproducibility)")
    ap.add_argument("--out", type=Path, default=DEFAULT_OUT)
    args = ap.parse_args(argv)
    rows, stats = build(GitRepo(args.repo, args.ref))
    write_csv(args.out / "kbo_dataset.csv", rows)
    write_json(args.out / "kbo_dataset_stats.json", stats)
    print(json.dumps(stats, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

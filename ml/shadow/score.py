#!/usr/bin/env python3
"""Phase 3 shadow scorer: memory/<sport>/<mm>/<dd>/<yyyy>/slate.json -> shadow.json.

    python3 -m ml.shadow.score --sport kbo|wnba|nfl|all [--date YYYY-MM-DD] [--memory-root memory]
                               [--nfl-data-dir ml/data/nfl] [--refresh-nflverse] [--dry-run]

For every frozen prop, the SAME prop (player, stat, odds type, line) gets:
  * shadow_projection: the Phase 2 final fit (ml/params, knobs + linear
    calibration) when the stat's params say recommendation == "candidate";
    otherwise the current projection is carried (carried_current = true, with a flag);
  * p_over: the Phase 2 logistic P(over) where a calibrator exists (standard
    lines only; it uses the fit projection it was trained on);
  * shadow_side: OVER/UNDER from shadow_projection vs line for candidate stats;
    carried stats carry the current pick so they grade identically;
  * top-confidence flags (top 20% of the day's standard lines by |edge| / stat MAE),
    separately for current and shadow.
Inputs are pinned to a pregame git ref per prop (see ml/shadow/common.py); rows
that cannot be pinned leak-free are kept with shadow_status "not_scored".

Re-scoring: a day is (re)scored when shadow.json is missing, the slate changed
(slate_sha256), or, while the day is not yet graded, the params changed.
Graded days keep their shadow.json unless the slate itself changed.
Writes only shadow.json. Never touches slate/recap/summary/meta.
"""
from __future__ import annotations

import argparse
import json
import math
import sys
from datetime import date
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[2]))

from ml.common.util import REPO_ROOT, parse_date, to_float  # noqa: E402
from ml.shadow import common as C  # noqa: E402
from ml.shadow.projectors import NflValues, current_projection_valid, make_projector  # noqa: E402

SIDES = ("OVER", "UNDER")


def norm_side(value) -> str | None:
    v = str(value or "").strip().upper()
    if v in SIDES:
        return v
    if "OV" in v:
        return "OVER"
    if "UN" in v:
        return "UNDER"
    return None


def side_of(projection, line) -> str | None:
    if projection is None or line is None or projection == line:
        return None
    return "OVER" if projection > line else "UNDER"


def stat_scale(p: dict | None, line: float) -> float:
    """Typical error of the stat (Phase 2 walk-forward MAE of the current formula), for comparable confidence."""
    mae = to_float(((p or {}).get("walk_forward") or {}).get("mae_current"))
    return mae if mae and mae > 0 else max(abs(line), 1.0)


def r3(x):
    return None if x is None else round(float(x), 3)


def score_prop(sport: str, d: date, slate: dict, prop: dict, params: dict, projector, hist: C.History) -> dict:
    label = prop.get("stat")
    stat = C.params_stat(sport, label)
    p = params.get(stat)
    line = to_float(prop.get("line"))
    odds = str(prop.get("odds_type") or "standard").lower()
    cur_ok, cur_why = current_projection_valid(sport, prop)
    current = float(prop["projection"]) if cur_ok else None
    row = {
        "player": prop.get("player"), "team": prop.get("team"), "opponent": prop.get("opponent"),
        "stat": label, "params_stat": stat if p else None, "odds_type": odds, "line": line,
        "current_projection": r3(current), "current_projection_note": cur_why or None,
        "current_side": norm_side(prop.get("recommendation")),
        "shadow_projection": None, "shadow_side": None, "shadow_source": None, "carried_current": None,
        "flag": None, "fit_projection": None, "fit_note": None, "p_over": None, "p_over_note": None,
        "input_ref": None, "pin": None, "start_time_utc": prop.get("start_time_utc"),
        "frozen_at": prop.get("last_pregame_frozen_at") or slate.get("frozen_at"),
        "shadow_status": "scored", "_scale": stat_scale(p, line or 0.0),
    }
    sha, pin = C.pin_prop(sport, d, slate, prop, hist)
    row["pin"] = pin
    if sha is None:
        row.update(shadow_status="not_scored", flag=pin)
        return row
    row["input_ref"] = sha[:12]
    if line is None:
        row.update(shadow_status="not_scored", flag="no_line")
        return row
    candidate = bool(p) and p.get("recommendation") == "candidate"
    fit = None
    if p and (candidate or p.get("p_over")):
        try:
            fit, note = projector.project(stat, prop, d, sha)
        except Exception as exc:  # noqa: BLE001 - one bad prop must not stop the day
            fit, note = None, f"error:{type(exc).__name__}"
        row["fit_projection"], row["fit_note"] = r3(fit), note
    if candidate and fit is not None:
        row.update(shadow_projection=r3(fit), shadow_source="candidate", carried_current=False,
                   shadow_side=side_of(round(fit, 3), line))
    else:
        flag = ("no_params" if not p else "keep_current" if not candidate
                else f"candidate_inputs_unavailable:{row['fit_note']}")
        row.update(shadow_projection=r3(current), shadow_source="current", carried_current=True, flag=flag,
                   shadow_side=row["current_side"])
    if p and p.get("p_over"):
        if odds not in C.STANDARD_ODDS:
            row["p_over_note"] = "calibrator_trained_on_standard_lines_only"
        elif fit is None:
            row["p_over_note"] = "fit_projection_unavailable"
        else:
            row["p_over"] = round(C.p_over(p["p_over"], fit, line), 4)
            row["p_over_note"] = f"p_over_recommendation={p.get('p_over_recommendation')}"
    else:
        row["p_over_note"] = "no_calibrator"
    return row


def mark_top(rows: list[dict]) -> None:
    """Top-confidence bucket per method: top 20% (ceil) of the day's standard lines by |edge| / stat MAE."""
    for method, proj_key, side_key in (("current", "current_projection", "current_side"),
                                       ("shadow", "shadow_projection", "shadow_side")):
        pool = []
        for i, r in enumerate(rows):
            r[f"top_{method}"] = False
            r[f"confidence_{method}"] = None
            if r["shadow_status"] != "scored" or r["odds_type"] not in C.STANDARD_ODDS:
                continue
            proj, line = r.get(proj_key), r.get("line")
            if proj is None or line is None or r.get(side_key) is None:
                continue
            conf = abs(proj - line) / r["_scale"]
            r[f"confidence_{method}"] = round(conf, 4)
            if conf > 0:
                pool.append((-conf, str(r["player"]), str(r["stat"]), i))
        pool.sort()
        for *_, i in pool[: math.ceil(C.TOP_FRACTION * len(pool))]:
            rows[i][f"top_{method}"] = True


def score_day(sport: str, d: date, ddir: Path, params: dict, pver: dict, projector, hist: C.History,
              excluded: dict) -> dict:
    slate_path = ddir / "slate.json"
    raw = slate_path.read_text(encoding="utf-8")
    slate = json.loads(raw)
    base = {
        "schema": C.SHADOW_SCHEMA, "sport": sport, "slate_date": slate.get("slate_date"),
        "slate_date_iso": d.isoformat(), "generated_at": C.utc_now_iso(),
        "mode": "shadow (offline; never shown on the site)",
        "slate_sha256": C.sha256_text(raw)[:16], "slate_frozen_at": slate.get("frozen_at"),
        "params": pver,
        "rules": {
            "shadow_projection": "Phase 2 final fit (knobs + linear calibration) for stats with recommendation=candidate; "
                                 "otherwise the current projection is carried (carried_current=true)",
            "shadow_side": "candidate stats: sign(shadow_projection - line); carried stats: current pick",
            "p_over": "Phase 2 logistic on (fit_projection - line, line); standard lines only",
            "top_bucket": f"top {int(C.TOP_FRACTION * 100)}% of the day's standard lines by |projection - line| / "
                          "stat walk-forward MAE, separately for current and shadow",
            "leakage": "inputs pinned per prop at its pregame ref (source_commit, or last commit before a provably "
                       "pregame legacy freeze); game logs filtered to dates before the game date",
        },
    }
    reason = excluded.get((sport, d.isoformat()))
    if reason:
        return dict(base, status="excluded", reason=reason, counts={"props": 0}, props=[])
    rows = [score_prop(sport, d, slate, prop, params, projector, hist) for prop in slate.get("props") or []]
    mark_top(rows)
    for r in rows:
        r.pop("_scale", None)
    scored = [r for r in rows if r["shadow_status"] == "scored"]
    counts = {
        "props": len(rows), "scored": len(scored), "not_scored": len(rows) - len(scored),
        "shadow_candidate": sum(1 for r in scored if r["shadow_source"] == "candidate"),
        "carried_current": sum(1 for r in scored if r["carried_current"]),
        "with_p_over": sum(1 for r in scored if r["p_over"] is not None),
        "top_current": sum(1 for r in rows if r["top_current"]), "top_shadow": sum(1 for r in rows if r["top_shadow"]),
    }
    reasons: dict = {}
    for r in rows:
        if r["shadow_status"] != "scored":
            reasons[r["flag"]] = reasons.get(r["flag"], 0) + 1
    refs: dict = {}
    for r in scored:
        refs[r["input_ref"]] = refs.get(r["input_ref"], 0) + 1
    status = "scored" if scored else "not_scored"
    out = dict(base, status=status, counts=counts, input_refs=refs, props=rows)
    if reasons:
        out["not_scored_reasons"] = reasons
    return out


def needs_rescore(existing: dict | None, slate_sha: str, pver: dict, locked: bool) -> bool:
    if not existing:
        return True
    if existing.get("slate_sha256") != slate_sha:
        return True
    if locked:
        return False
    return (existing.get("params") or {}).get("sha256") != pver.get("sha256")


def run(sport: str, root: Path, only: date | None = None, dry_run: bool = False, nfl_values: NflValues | None = None,
        repo_root: Path = REPO_ROOT, force: bool = False, params_dir: Path = C.PARAMS_DIR) -> list[dict]:
    params = C.load_params(sport, params_dir)
    pver = C.params_version(sport, params_dir, repo_root)
    hist = C.History(repo_root)
    projector = make_projector(sport, hist, params, nfl_values)
    excluded = C.exclusions(root)
    out = []
    for d, ddir in C.memory_days(sport, root):
        if only and d != only:
            continue
        slate_path = ddir / "slate.json"
        if not slate_path.exists():
            continue
        slate_sha = C.sha256_text(slate_path.read_text(encoding="utf-8"))[:16]
        existing = C.load_json(ddir / C.SHADOW_FILE)
        state = C.day_state(ddir)
        if not force and not needs_rescore(existing, slate_sha, pver, state["locked"]):
            out.append({"sport": sport, "date": d.isoformat(), "action": "up_to_date"})
            continue
        result = score_day(sport, d, ddir, params, pver, projector, hist, excluded)
        changed = False if dry_run else C.write_json_if_changed(ddir / C.SHADOW_FILE, result)
        out.append({"sport": sport, "date": d.isoformat(), "action": "written" if changed else "unchanged",
                    "status": result["status"], "counts": result["counts"],
                    **({"not_scored_reasons": result["not_scored_reasons"]} if result.get("not_scored_reasons") else {})})
    return out


def main(argv=None) -> int:
    ap = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    ap.add_argument("--sport", choices=(*C.SPORTS, "all"), required=True)
    ap.add_argument("--date", help="Only this slate date (YYYY-MM-DD or mm/dd/YYYY)")
    ap.add_argument("--memory-root", type=Path, default=C.MEMORY_ROOT)
    ap.add_argument("--nfl-data-dir", type=Path, default=None)
    ap.add_argument("--refresh-nflverse", action="store_true", help="Re-download the current nflverse season")
    ap.add_argument("--force", action="store_true", help="Re-score even when up to date")
    ap.add_argument("--dry-run", action="store_true")
    args = ap.parse_args(argv)
    only = parse_date(args.date) if args.date else None
    nfl_values = NflValues(args.nfl_data_dir, refresh_current=args.refresh_nflverse)
    results = []
    for sport in (C.SPORTS if args.sport == "all" else (args.sport,)):
        try:
            results += run(sport, args.memory_root, only, args.dry_run, nfl_values, force=args.force)
        except Exception as exc:  # noqa: BLE001 - shadow must never break a workflow
            results.append({"sport": sport, "error": f"{type(exc).__name__}: {exc}"})
    print(json.dumps(results, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

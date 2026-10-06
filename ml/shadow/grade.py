#!/usr/bin/env python3
"""Phase 3 shadow grader + cumulative scoreboard.

    python3 -m ml.shadow.grade --sport kbo|wnba|nfl|all [--date YYYY-MM-DD] [--memory-root memory]

For each memory day that is graded complete (meta.status == "complete" and
recap.json exists), not excluded in memory/evaluation_exclusions.json, and has a
scored shadow.json whose slate_sha256 matches the current slate.json, writes
memory/<sport>/<mm>/<dd>/<yyyy>/shadow_summary.json with current vs shadow side by
side (hits, misses, hit rate, MAE, top-confidence bucket), per stat and overall,
using the SAME actuals and results as recap.json.

A partial day is included too when every leftover prop is an unmapped stat
(the box score will never fill those in) and graded.json has the rows that did
grade. A partial day still waiting on box scores is left alone. Then rebuilds
memory/<sport>/shadow_scoreboard.json (running totals since shadow start, D3
promotion thresholds, status).

Reads recap.json / slate.json / meta.json; writes only shadow_summary.json and
shadow_scoreboard.json. "current" counts come from recap.json model_result, so
they equal summary.json for the same props.
"""
from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[2]))

from ml.common.util import norm_name, parse_date, to_float  # noqa: E402
from ml.shadow import common as C  # noqa: E402
from pipeline.memory.common import model_result  # noqa: E402

DECIDED = ("OVER", "UNDER")
# Missing reasons that will not clear up on the next box-score refresh.
# no_boxscore is not in this set: those days are still waiting on finals.
NONBLOCKING_MISSING = frozenset({"unmapped_stat"})


def key(row: dict) -> tuple:
    return (norm_name(row.get("player")), str(row.get("stat") or "").strip().lower(),
            str(row.get("odds_type") or "standard").strip().lower())


def outcome(side: str | None, result: str) -> str:
    if result == "VOID":
        return "VOID"
    if result == "DNP":
        return "DNP"
    if result == "PUSH":
        return "PUSH"
    if result not in DECIDED:
        return "N/A"
    if side not in DECIDED:
        return "NO_PICK"
    return "HIT" if side == result else "MISS"


def current_outcome(recap_row: dict) -> str:
    mr = str(recap_row.get("model_result") or "").upper()
    res = str(recap_row.get("result") or "").upper()
    if res == "VOID":
        return "VOID"
    if res == "DNP":
        return "DNP"
    if mr in ("HIT", "MISS", "PUSH"):
        return mr
    if res == "PUSH":
        return "PUSH"
    return "NO_PICK" if res in DECIDED else "N/A"


def new_block() -> dict:
    return {"hits": 0, "misses": 0, "pushes": 0, "dnps": 0, "voids": 0, "no_pick": 0}


def add(block: dict, oc: str) -> None:
    k = {"HIT": "hits", "MISS": "misses", "PUSH": "pushes", "DNP": "dnps", "VOID": "voids", "NO_PICK": "no_pick"}.get(oc)
    if k:
        block[k] += 1


def finish(block: dict) -> dict:
    n = block["hits"] + block["misses"]
    block["hit_rate"] = round(block["hits"] / n, 6) if n else None
    block["hit_rate_pct"] = round(100 * block["hits"] / n, 1) if n else None
    return block


class Agg:
    """Side-by-side accumulator for one scope (overall / stat / candidate-only)."""

    def __init__(self):
        self.graded = 0  # decided or push results (DNP and VOID excluded)
        self.current, self.shadow, self.current_edge = new_block(), new_block(), new_block()
        self.top_current, self.top_shadow = new_block(), new_block()
        self.abs_cur = self.abs_sh = 0.0
        self.n_mae = 0
        self.abs_sh_all, self.n_sh_all = 0.0, 0
        self.paired = {"n": 0, "current_hits": 0, "shadow_hits": 0}

    def add(self, g: dict) -> None:
        if g["result"] in DECIDED or g["result"] == "PUSH":
            self.graded += 1
        add(self.current, g["current_result"])
        add(self.shadow, g["shadow_result"])
        add(self.current_edge, g["current_edge_result"])
        if g["top_current"]:
            add(self.top_current, g["current_result"])
        if g["top_shadow"]:
            add(self.top_shadow, g["shadow_result"])
        if g["abs_err_current"] is not None and g["abs_err_shadow"] is not None:
            self.abs_cur += g["abs_err_current"]
            self.abs_sh += g["abs_err_shadow"]
            self.n_mae += 1
        if g["abs_err_shadow"] is not None:
            self.abs_sh_all += g["abs_err_shadow"]
            self.n_sh_all += 1
        if g["current_result"] in ("HIT", "MISS") and g["shadow_result"] in ("HIT", "MISS"):
            self.paired["n"] += 1
            self.paired["current_hits"] += g["current_result"] == "HIT"
            self.paired["shadow_hits"] += g["shadow_result"] == "HIT"

    def merge(self, d: dict) -> None:
        """Add a finished dict (from a daily shadow_summary.json) into this accumulator."""
        self.graded += d.get("graded_props", 0)
        for name in ("current", "shadow", "current_edge"):
            for k in new_block():
                getattr(self, name)[k] += (d.get(name) or {}).get(k, 0)
        for name, src in (("top_current", "current"), ("top_shadow", "shadow")):
            for k in new_block():
                getattr(self, name)[k] += ((d.get("top_bucket") or {}).get(src) or {}).get(k, 0)
        m = d.get("mae") or {}
        if m.get("n"):
            self.abs_cur += m["sum_abs_current"]
            self.abs_sh += m["sum_abs_shadow"]
            self.n_mae += m["n"]
        m = d.get("mae_shadow_all") or {}
        if m.get("n"):
            self.abs_sh_all += m["sum_abs"]
            self.n_sh_all += m["n"]
        for k in self.paired:
            self.paired[k] += (d.get("paired") or {}).get(k, 0)

    def out(self) -> dict:
        n = self.n_mae
        mae = {"n": n, "current": round(self.abs_cur / n, 4) if n else None,
               "shadow": round(self.abs_sh / n, 4) if n else None,
               "delta": round((self.abs_sh - self.abs_cur) / n, 4) if n else None,
               "sum_abs_current": round(self.abs_cur, 4), "sum_abs_shadow": round(self.abs_sh, 4)}
        cur, sh = finish(dict(self.current)), finish(dict(self.shadow))
        delta = None
        if cur["hit_rate"] is not None and sh["hit_rate"] is not None:
            delta = round(100 * (sh["hit_rate"] - cur["hit_rate"]), 1)
        pn = self.paired["n"]
        paired = dict(self.paired, current_hit_rate_pct=round(100 * self.paired["current_hits"] / pn, 1) if pn else None,
                      shadow_hit_rate_pct=round(100 * self.paired["shadow_hits"] / pn, 1) if pn else None)
        mae_all = {"n": self.n_sh_all, "shadow": round(self.abs_sh_all / self.n_sh_all, 4) if self.n_sh_all else None,
                   "sum_abs": round(self.abs_sh_all, 4)}
        return {"graded_props": self.graded, "current": cur, "shadow": sh, "hit_rate_delta_pct_points": delta,
                "paired": paired, "current_edge": finish(dict(self.current_edge)), "mae": mae,
                "mae_shadow_all": mae_all,
                "top_bucket": {"current": finish(dict(self.top_current)), "shadow": finish(dict(self.top_shadow))}}


def grade_rows(shadow: dict, recap: dict) -> list[dict]:
    by_key = {key(r): r for r in recap.get("props") or []}
    out = []
    for s in shadow.get("props") or []:
        if s.get("shadow_status") != "scored":
            continue
        r = by_key.get(key(s))
        if r is None:
            continue
        res = str(r.get("result") or "").upper()
        actual = to_float(r.get("actual"))
        line = to_float(s.get("line"))
        has_actual = actual is not None and res not in ("DNP", "VOID")
        cur, sh = s.get("current_projection"), s.get("shadow_projection")
        cur_edge_side = None if cur is None or line is None or cur == line else ("OVER" if cur > line else "UNDER")
        if s.get("current_from_baseline"):
            # Site pick is the tuned formula. Keep "current" on the pre-promotion side
            # so the running old-vs-tuned scoreboard does not collapse.
            graded_current = current_outcome({"model_result": model_result(res, s.get("current_side")), "result": res})
        else:
            graded_current = current_outcome(r)
        out.append({
            "player": s.get("player"), "team": s.get("team"), "stat": s.get("stat"), "odds_type": s.get("odds_type"),
            "line": line, "actual": actual, "result": res,
            "current_projection": cur, "current_side": s.get("current_side"), "current_result": graded_current,
            "published_projection": s.get("published_projection"), "published_side": s.get("published_side"),
            "published_result": current_outcome(r) if s.get("current_from_baseline") else None,
            "shadow_projection": sh, "shadow_side": s.get("shadow_side"), "shadow_result": outcome(s.get("shadow_side"), res),
            "shadow_source": s.get("shadow_source"), "p_over": s.get("p_over"),
            "current_edge_result": outcome(cur_edge_side, res),
            "top_current": bool(s.get("top_current")), "top_shadow": bool(s.get("top_shadow")),
            "abs_err_current": round(abs(cur - actual), 4) if has_actual and cur is not None else None,
            "abs_err_shadow": round(abs(sh - actual), 4) if has_actual and sh is not None else None,
        })
    return out


def summarize_rows(rows: list[dict]) -> dict:
    overall, cand, per = Agg(), Agg(), {}
    for g in rows:
        overall.add(g)
        if g["shadow_source"] == "candidate":
            cand.add(g)
        per.setdefault(g["stat"], Agg()).add(g)
    return {"overall": overall.out(), "candidate_rows_only": cand.out(),
            "per_stat": {k: per[k].out() for k in sorted(per)}}


def comparison_actuals(ddir: Path) -> tuple[dict | None, str, str]:
    """(payload, source filename, skip reason).

    Complete days use recap.json. Partial days use graded.json only when every
    missing prop is an unmapped stat, so a handful of quarter props does not
    hide the rest of the day's tuned-vs-current file.
    """
    state = C.day_state(ddir)
    if state["complete"]:
        return C.load_json(ddir / "recap.json") or {}, "recap.json", ""
    if state["status"] != "partial":
        return None, "", "day_not_complete"
    meta = C.load_json(ddir / "meta.json") or {}
    if meta.get("missing_truncated"):
        return None, "", "day_not_complete"
    reasons = []
    for item in meta.get("missing") or []:
        reasons.append(item.get("reason") if isinstance(item, dict) else "other")
    if not reasons or any(reason not in NONBLOCKING_MISSING for reason in reasons):
        return None, "", "day_not_complete"
    graded = C.load_json(ddir / "graded.json") or {}
    if not graded.get("props"):
        return None, "", "partial_without_graded_rows"
    return graded, "graded.json", ""


def grade_day(sport: str, d, ddir: Path, excluded: dict) -> tuple[dict | None, str]:
    if (sport, d.isoformat()) in excluded:
        return None, "excluded"
    recap, actuals_file, skip = comparison_actuals(ddir)
    if recap is None:
        return None, skip
    shadow = C.load_json(ddir / C.SHADOW_FILE)
    if not shadow:
        return None, "no_shadow"
    if shadow.get("status") != "scored":
        return None, f"shadow_{shadow.get('status')}"
    slate_raw = (ddir / "slate.json").read_text(encoding="utf-8")
    if shadow.get("slate_sha256") != C.sha256_text(slate_raw)[:16]:
        return None, "shadow_stale(slate_changed); run ml.shadow.score first"
    rows = grade_rows(shadow, recap)
    summ = summarize_rows(rows)
    out = {
        "schema": C.SHADOW_SCHEMA, "sport": sport, "slate_date": shadow.get("slate_date"),
        "slate_date_iso": d.isoformat(), "period": C.period_of(sport, d), "graded_at": C.utc_now_iso(),
        "status": "graded", "evaluation": {"excluded": False},
        "sources": {"shadow": C.SHADOW_FILE, "recap": actuals_file, "recap_graded_at": recap.get("graded_at")
                    or next((p.get("graded_at") for p in recap.get("props") or []), None)},
        "params": shadow.get("params"),
        "definitions": {
            "current": (
                "pre-promotion formula (baseline_recommendation vs recap result) while the site is publishing "
                "the tuned formula; published_result is the site pick (recap model_result)"
                if any(p.get("current_from_baseline") for p in (shadow.get("props") or []))
                else "recap.json model_result (the site's pick), same as summary.json"
            ),
            "shadow": "shadow_side vs recap result (candidate stats: Phase 2 fit; other stats carry the current pick)",
            "current_edge": "sign(current_projection - line) vs result (projection-only benchmark)",
            "hit_rate": "hits / (hits + misses); pushes, DNPs, voids and no-pick rows excluded",
            "paired": "only rows where BOTH current and shadow made a decided pick (apples-to-apples hit rate)",
            "mae": "paired rows with an actual where both projections exist (legacy KBO pitcher cg scores excluded)",
            "mae_shadow_all": "shadow MAE over every row with an actual (includes rows without a current projection)",
            "top_bucket": "rows flagged top_current / top_shadow in shadow.json (top 20% of standard lines by "
                          "|projection - line| / stat MAE, chosen pregame)",
        },
        **summ,
        "props": rows,
    }
    return out, "graded"


# -- scoreboard --


def status_for(sport: str, periods: int, props: int, block: dict) -> str:
    th = C.THRESHOLDS[sport]
    if periods < th["min_periods"] or props < th["min_props"]:
        return "collecting"
    cur, sh = block["current"]["hit_rate"], block["shadow"]["hit_rate"]
    mc, ms = block["mae"]["current"], block["mae"]["shadow"]
    if None in (cur, sh):
        return "meets-thresholds"
    better_hit, worse_hit = sh > cur, sh < cur
    better_mae = mc is not None and ms is not None and ms < mc
    worse_mae = mc is not None and ms is not None and ms > mc
    if better_hit and not worse_mae:
        return "beating"
    if worse_hit and not better_mae:
        return "losing"
    return "meets-thresholds"


def build_scoreboard(sport: str, root: Path) -> dict:
    excluded = C.exclusions(root)
    days = []
    for d, ddir in C.memory_days(sport, root):
        s = C.load_json(ddir / C.SHADOW_SUMMARY_FILE)
        if not s or s.get("status") != "graded" or (sport, d.isoformat()) in excluded:
            continue
        days.append((d, s))
    th = C.THRESHOLDS[sport]
    overall, cand, per = Agg(), Agg(), {}
    stat_periods: dict = {}
    periods = set()
    for d, s in days:
        periods.add(s.get("period") or C.period_of(sport, d))
        overall.merge(s["overall"])
        cand.merge(s["candidate_rows_only"])
        for stat, blk in (s.get("per_stat") or {}).items():
            per.setdefault(stat, Agg()).merge(blk)
            if blk.get("graded_props"):
                stat_periods.setdefault(stat, set()).add(s.get("period") or C.period_of(sport, d))
    o, c = overall.out(), cand.out()
    per_out = {}
    for stat in sorted(per):
        b = per[stat].out()
        n_per = len(stat_periods.get(stat, ()))
        b.update(periods=n_per, status=status_for(sport, n_per, b["graded_props"], b))
        per_out[stat] = b
    n_periods = len(periods)
    return {
        "schema": C.SHADOW_SCHEMA, "sport": sport, "updated_at": C.utc_now_iso(),
        "shadow_start": days[0][0].isoformat() if days else None,
        "last_graded": days[-1][0].isoformat() if days else None,
        "graded_days": [d.isoformat() for d, _ in days],
        "periods": n_periods, "period_unit": th["unit"],
        "thresholds": {"min_periods": th["min_periods"], "min_props": th["min_props"], "unit": th["unit"],
                       "props_counted": "graded props on candidate-sourced rows (candidate_rows_only.graded_props)"},
        "progress": {"periods": f"{n_periods}/{th['min_periods']}", "props": f"{c['graded_props']}/{th['min_props']}"},
        "status": status_for(sport, n_periods, c["graded_props"], c),
        "status_rules": {
            "collecting": "below the D3 minimum sample (periods or props)",
            "beating": "thresholds met; shadow hit rate > current and shadow MAE not worse",
            "losing": "thresholds met; shadow hit rate < current and shadow MAE not better",
            "meets-thresholds": "thresholds met but mixed/tied result",
        },
        "overall": o, "candidate_rows_only": c, "per_stat": per_out,
    }


def run(sport: str, root: Path, only=None, dry_run: bool = False) -> list[dict]:
    excluded = C.exclusions(root)
    out = []
    for d, ddir in C.memory_days(sport, root):
        if only and d != only:
            continue
        summ, why = grade_day(sport, d, ddir, excluded)
        if summ is None:
            if (ddir / "slate.json").exists():
                out.append({"sport": sport, "date": d.isoformat(), "action": "skipped", "reason": why})
            continue
        changed = False if dry_run else C.write_json_if_changed(ddir / C.SHADOW_SUMMARY_FILE, summ)
        o = summ["overall"]
        out.append({"sport": sport, "date": d.isoformat(), "action": "written" if changed else "unchanged",
                    "current": f"{o['current']['hits']}-{o['current']['misses']} ({o['current']['hit_rate_pct']}%)",
                    "shadow": f"{o['shadow']['hits']}-{o['shadow']['misses']} ({o['shadow']['hit_rate_pct']}%)"})
    board = build_scoreboard(sport, root)
    if board["graded_days"] and not dry_run:
        changed = C.write_json_if_changed(Path(root) / sport / C.SCOREBOARD_FILE, board)
        out.append({"sport": sport, "scoreboard": "written" if changed else "unchanged", "status": board["status"],
                    "progress": board["progress"]})
    return out


def main(argv=None) -> int:
    ap = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    ap.add_argument("--sport", choices=(*C.SPORTS, "all"), required=True)
    ap.add_argument("--date")
    ap.add_argument("--memory-root", type=Path, default=C.MEMORY_ROOT)
    ap.add_argument("--dry-run", action="store_true")
    args = ap.parse_args(argv)
    only = parse_date(args.date) if args.date else None
    results = []
    for sport in (C.SPORTS if args.sport == "all" else (args.sport,)):
        try:
            results += run(sport, args.memory_root, only, args.dry_run)
        except Exception as exc:  # noqa: BLE001 - shadow must never break a workflow
            results.append({"sport": sport, "error": f"{type(exc).__name__}: {exc}"})
    print(json.dumps(results, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

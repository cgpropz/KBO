"""Unit tests for Phase 3 shadow mode (ml/shadow). Plain python3, no pytest:

    python3 ml/tests/test_ml_phase3.py
    python3 -m unittest discover -s ml/tests -t .      (from the repo root)

Integration tests that need the repo's git history (pinned refs) skip
themselves when the objects are missing (shallow clones).
"""
from __future__ import annotations

import hashlib
import json
import re
import shutil
import subprocess
import sys
import tempfile
import unittest
from datetime import date, datetime, timezone
from pathlib import Path

REPO = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(REPO))

from ml.shadow import common as C  # noqa: E402
from ml.shadow import grade as G  # noqa: E402
from ml.shadow import score as S  # noqa: E402
from ml.shadow.projectors import current_projection_valid  # noqa: E402

UTC = timezone.utc


class FakeHistory:
    def __init__(self, commits=None, before=None):
        self.commits = commits or {}  # short -> (sha, commit time)
        self.before = before

    def resolve(self, rev):
        return self.commits.get(rev, (None, None))[0]

    def commit_time(self, sha):
        return next((t for s, t in self.commits.values() if s == sha), None)

    def last_commit_before(self, ts):
        return self.before


class FakeProjector:
    def __init__(self, value=10.0, note="replayed"):
        self.value, self.note = value, note

    def project(self, stat, prop, d, sha):
        return self.value, self.note


def params(stat, rec="candidate", cal=None, p_over=None, mae=2.0, is_current=False):
    return {"stat": stat, "recommendation": rec, "formula": {"is_current": is_current, "knobs": {}},
            "linear_calibration": cal, "p_over": p_over, "p_over_recommendation": "not_better_than_constant",
            "walk_forward": {"mae_current": mae}}


def s2(**kw):
    base = {"player": "A", "stat": "Points", "line": 10.5, "odds_type": "standard", "projection": 12.0,
            "recommendation": "OVER", "projection_schema": 2, "source_commit": "abc123",
            "start_time_utc": "2026-09-25T23:00:00+00:00", "last_pregame_frozen_at": "2026-09-25T20:00:00+00:00"}
    base.update(kw)
    return base


class TestPinning(unittest.TestCase):
    def setUp(self):
        self.hist = FakeHistory({"abc123": ("abc123full", datetime(2026, 9, 25, 19, tzinfo=UTC))},
                                before="legacyref")

    def test_schema2_uses_source_commit(self):
        self.assertEqual(C.pin_prop("wnba", date(2026, 9, 25), {}, s2(), self.hist), ("abc123full", "source_commit"))

    def test_schema2_frozen_after_start_rejected(self):
        sha, why = C.pin_prop("wnba", date(2026, 9, 25), {}, s2(last_pregame_frozen_at="2026-09-25T23:05:00Z"), self.hist)
        self.assertIsNone(sha)
        self.assertIn("not_pregame", why)

    def test_cutoff_ignored_rejected(self):
        self.assertEqual(C.pin_prop("wnba", date(2026, 9, 25), {}, s2(cutoff_ignored=True), self.hist)[0], None)

    def test_source_commit_after_freeze_rejected(self):
        hist = FakeHistory({"abc123": ("abc123full", datetime(2026, 9, 25, 21, tzinfo=UTC))})
        self.assertEqual(C.pin_prop("wnba", date(2026, 9, 25), {}, s2(), hist),
                         (None, "source_commit_after_freeze"))

    def test_legacy_kbo_pregame_ok_and_late_rejected(self):
        legacy = {"player": "A", "stat": "Hits+Runs+RBIs", "line": 1.5}
        thu = date(2026, 9, 24)  # Thursday: earliest first pitch 18:30 KST = 09:30 UTC
        ok = C.pin_prop("kbo", thu, {"frozen_at": "2026-09-24T05:57:52Z"}, legacy, self.hist)
        self.assertEqual(ok, ("legacyref", "legacy_last_commit_before_freeze"))
        late = C.pin_prop("kbo", thu, {"frozen_at": "2026-09-24T09:31:00Z"}, legacy, self.hist)
        self.assertEqual(late[0], None)
        sat = date(2026, 9, 26)  # Saturday: 14:00 KST = 05:00 UTC
        self.assertIsNone(C.pin_prop("kbo", sat, {"frozen_at": "2026-09-26T05:10:00Z"}, legacy, self.hist)[0])

    def test_legacy_wnba_evening_freeze_rejected(self):
        # WNBA 09/24 slate frozen 9:02 PM ET, after the 12:00 PM ET conservative tip bound.
        r = C.pin_prop("wnba", date(2026, 9, 24), {"frozen_at": "2026-09-25T01:02:20Z"}, {"player": "A"}, self.hist)
        self.assertEqual(r, (None, "legacy_freeze_not_provably_pregame"))

    def test_legacy_nfl(self):
        frozen = {"frozen_at": "2026-09-25T00:22:00Z"}
        self.assertIsNone(C.pin_prop("nfl", date(2026, 9, 24), frozen, {"player": "A"}, self.hist)[0])  # TNF
        self.assertEqual(C.pin_prop("nfl", date(2026, 9, 27), frozen, {"player": "A"}, self.hist)[0], "legacyref")


class TestMath(unittest.TestCase):
    def test_linear_and_p_over(self):
        self.assertEqual(C.linear(None, 3.0), 3.0)
        self.assertAlmostEqual(C.linear({"a": 1.0, "b": 0.5}, 4.0), 3.0)
        m = {"intercept": 0.0, "coef": {"edge": 1.0, "line": 0.0}}
        self.assertAlmostEqual(C.p_over(m, 5.0, 5.0), 0.5)
        self.assertGreater(C.p_over(m, 7.0, 5.0), 0.5)
        self.assertAlmostEqual(C.p_over(m, 5.0 + 800, 5.0), 1.0)  # no overflow
        self.assertAlmostEqual(C.p_over(m, 5.0 - 800, 5.0), 0.0)
        self.assertIsNone(C.p_over(None, 1, 1))

    def test_current_projection_validity(self):
        self.assertFalse(current_projection_valid("kbo", {"role": "pitcher", "projection": 80, "line": 4.5})[0])
        self.assertTrue(current_projection_valid("kbo", {"role": "pitcher", "projection": 4.4, "line": 4.5,
                                                         "projection_schema": 2})[0])
        self.assertFalse(current_projection_valid("nfl", {"projection": 14.5, "line": 14.5})[0])
        self.assertFalse(current_projection_valid("nfl", {"projection": 20, "line": 14.5,
                                                          "projection_is_line_fallback": True})[0])
        self.assertTrue(current_projection_valid("nfl", {"projection": 20, "line": 14.5})[0])

    def test_period_and_aliases(self):
        self.assertEqual(C.period_of("kbo", date(2026, 9, 24)), "2026-09-24")
        weeks = {C.period_of("nfl", date(2026, 9, d)) for d in (24, 27, 28)}  # Thu, Sun, Mon
        self.assertEqual(weeks, {"week-of-2026-09-22"})
        self.assertNotEqual(C.period_of("nfl", date(2026, 9, 29)), C.period_of("nfl", date(2026, 9, 28)))
        self.assertEqual(C.params_stat("kbo", "Pitcher Strikeouts"), "Strikeouts")
        self.assertEqual(C.params_stat("kbo", "Hitter Fantasy Score"), "Fantasy Score")
        self.assertEqual(C.params_stat("wnba", "Points"), "Points")


class TestScoreProp(unittest.TestCase):
    hist = FakeHistory({"abc123": ("abc123full", datetime(2026, 9, 25, 19, tzinfo=UTC))})
    d = date(2026, 9, 25)

    def test_candidate_uses_fit_and_p_over(self):
        pm = {"Points": params("Points", p_over={"intercept": 0.0, "coef": {"edge": 1.0, "line": 0.0}})}
        r = S.score_prop("wnba", self.d, {}, s2(), pm, FakeProjector(9.0), self.hist)
        self.assertEqual((r["shadow_projection"], r["shadow_side"], r["shadow_source"]), (9.0, "UNDER", "candidate"))
        self.assertFalse(r["carried_current"])
        self.assertAlmostEqual(r["p_over"], round(C.p_over(pm["Points"]["p_over"], 9.0, 10.5), 4))
        self.assertEqual(r["current_side"], "OVER")
        self.assertEqual(r["input_ref"], "abc123full"[:12])

    def test_keep_current_is_carried_with_flag_and_same_pick(self):
        pm = {"Points": params("Points", rec="keep_current")}
        r = S.score_prop("wnba", self.d, {}, s2(recommendation="UNDER"), pm, FakeProjector(9.0), self.hist)
        self.assertTrue(r["carried_current"])
        self.assertEqual(r["flag"], "keep_current")
        self.assertEqual((r["shadow_projection"], r["shadow_side"]), (12.0, "UNDER"))  # current pick carried

    def test_no_params_and_goblin(self):
        r = S.score_prop("wnba", self.d, {}, s2(stat="Weird"), {}, FakeProjector(), self.hist)
        self.assertEqual(r["flag"], "no_params")
        pm = {"Points": params("Points", p_over={"intercept": 0.0, "coef": {"edge": 1.0, "line": 0.0}})}
        r = S.score_prop("wnba", self.d, {}, s2(odds_type="goblin"), pm, FakeProjector(9.0), self.hist)
        self.assertIsNone(r["p_over"])
        self.assertEqual(r["p_over_note"], "calibrator_trained_on_standard_lines_only")

    def test_candidate_inputs_missing_carries_current(self):
        pm = {"Points": params("Points")}
        r = S.score_prop("wnba", self.d, {}, s2(), pm, FakeProjector(None, "no_prior_games"), self.hist)
        self.assertTrue(r["carried_current"])
        self.assertEqual(r["flag"], "candidate_inputs_unavailable:no_prior_games")

    def test_unpinnable_row_not_scored(self):
        pm = {"Points": params("Points")}
        r = S.score_prop("wnba", self.d, {}, s2(cutoff_ignored=True), pm, FakeProjector(), self.hist)
        self.assertEqual(r["shadow_status"], "not_scored")
        self.assertIsNone(r["shadow_projection"])

    def test_top_bucket(self):
        rows = []
        for i in range(10):
            rows.append({"shadow_status": "scored", "odds_type": "standard", "line": 10.0, "player": f"p{i}", "stat": "x",
                         "current_projection": 10.0 + i, "current_side": "OVER",
                         "shadow_projection": 10.0 - i, "shadow_side": "UNDER", "_scale": 1.0})
        rows.append(dict(rows[-1], odds_type="goblin", player="g", current_projection=99.0, shadow_projection=-99.0))
        S.mark_top(rows)
        self.assertEqual([r["player"] for r in rows if r["top_current"]], ["p8", "p9"])  # ceil(20% of 9 nonzero)
        self.assertEqual([r["player"] for r in rows if r["top_shadow"]], ["p8", "p9"])
        self.assertFalse(rows[-1]["top_current"])  # goblin never in the bucket
        self.assertFalse(rows[0]["top_current"])  # zero edge never counts

    def test_needs_rescore(self):
        pv = {"sha256": "p1"}
        self.assertTrue(S.needs_rescore(None, "s", pv, False))
        ex = {"slate_sha256": "s", "params": {"sha256": "p0"}}
        self.assertTrue(S.needs_rescore(ex, "s2", pv, True))  # slate changed -> rescore even if locked
        self.assertFalse(S.needs_rescore(ex, "s", pv, True))  # graded day keeps its shadow on params change
        self.assertTrue(S.needs_rescore(ex, "s", pv, False))  # open day follows new params


def recap_row(player, stat, result, model_result, actual, line=1.5, projection=2.0, odds="standard"):
    return {"player": player, "stat": stat, "odds_type": odds, "line": line, "projection": projection,
            "actual": actual, "result": result, "model_result": model_result}


def shadow_row(player, stat, side, sh, cur=2.0, cur_side="OVER", source="candidate", odds="standard", **kw):
    r = {"player": player, "stat": stat, "odds_type": odds, "line": 1.5, "shadow_status": "scored",
         "current_projection": cur, "current_side": cur_side, "shadow_projection": sh, "shadow_side": side,
         "shadow_source": source, "top_current": False, "top_shadow": False, "p_over": None}
    r.update(kw)
    return r


class TestGrader(unittest.TestCase):
    def test_grade_rows_and_summary(self):
        recap = {"props": [
            recap_row("A", "HRR", "OVER", "HIT", 3), recap_row("B", "HRR", "UNDER", "MISS", 0),
            recap_row("C", "HRR", "DNP", "N/A", None), recap_row("D", "HRR", "PUSH", "PUSH", 1.5, line=1.5),
            recap_row("E", "HRR", "UNDER", "N/A", 1),
        ]}
        shadow = {"props": [
            shadow_row("A", "HRR", "UNDER", 1.0, top_shadow=True, top_current=True),
            shadow_row("B", "HRR", "UNDER", 1.0), shadow_row("C", "HRR", "OVER", 2.5),
            shadow_row("D", "HRR", "OVER", 2.0), shadow_row("E", "HRR", "UNDER", 1.2, cur_side=None),
            shadow_row("Z", "HRR", "OVER", 3.0),  # not in recap -> ignored
        ]}
        rows = G.grade_rows(shadow, recap)
        self.assertEqual(len(rows), 5)
        s = G.summarize_rows(rows)["overall"]
        self.assertEqual((s["current"]["hits"], s["current"]["misses"], s["current"]["pushes"], s["current"]["dnps"]),
                         (1, 1, 1, 1))
        self.assertEqual((s["shadow"]["hits"], s["shadow"]["misses"]), (2, 1))
        self.assertEqual(s["current"]["no_pick"], 1)
        self.assertEqual(s["paired"], {"n": 2, "current_hits": 1, "shadow_hits": 1,
                                       "current_hit_rate_pct": 50.0, "shadow_hit_rate_pct": 50.0})
        self.assertEqual(s["graded_props"], 4)
        self.assertEqual(s["mae"]["n"], 4)  # A, B, D, E (C is DNP)
        self.assertAlmostEqual(s["mae"]["current"], (1 + 2 + 0.5 + 1) / 4)
        self.assertEqual((s["top_bucket"]["current"]["hits"], s["top_bucket"]["shadow"]["misses"]), (1, 1))

    def test_current_matches_summary_counting(self):
        sys.path.insert(0, str(REPO))
        from pipeline.memory.common import compute_hit_rate_stats
        recap = {"props": [recap_row(str(i), "S", r, m, 1) for i, (r, m) in enumerate(
            [("OVER", "HIT"), ("UNDER", "MISS"), ("UNDER", "HIT"), ("PUSH", "PUSH"), ("DNP", "N/A"), ("OVER", "N/A")])]}
        shadow = {"props": [shadow_row(str(i), "S", "OVER", 2.0) for i in range(6)]}
        s = G.summarize_rows(G.grade_rows(shadow, recap))["overall"]["current"]
        ref = compute_hit_rate_stats(recap["props"])
        for k in ("hits", "misses", "pushes", "dnps", "hit_rate"):
            self.assertEqual(s[k], ref[k], k)

    def test_status_rules(self):
        blk = lambda c, s, mc, ms: {"current": {"hit_rate": c}, "shadow": {"hit_rate": s}, "mae": {"current": mc, "shadow": ms}}
        self.assertEqual(G.status_for("kbo", 29, 5000, blk(0.5, 0.6, 2, 1)), "collecting")
        self.assertEqual(G.status_for("kbo", 30, 999, blk(0.5, 0.6, 2, 1)), "collecting")
        self.assertEqual(G.status_for("kbo", 30, 1000, blk(0.5, 0.6, 2, 1)), "beating")
        self.assertEqual(G.status_for("kbo", 30, 1000, blk(0.6, 0.5, 1, 2)), "losing")
        self.assertEqual(G.status_for("kbo", 30, 1000, blk(0.5, 0.6, 1, 2)), "meets-thresholds")
        self.assertEqual(G.status_for("wnba", 20, 1500, blk(0.5, 0.5, 2, 2)), "meets-thresholds")
        self.assertEqual(G.status_for("nfl", 5, 9999, blk(0.5, 0.6, 2, 1)), "collecting")
        self.assertEqual(C.THRESHOLDS["kbo"], {"unit": "days", "min_periods": 30, "min_props": 1000})
        self.assertEqual(C.THRESHOLDS["wnba"], {"unit": "days", "min_periods": 20, "min_props": 1500})
        self.assertEqual(C.THRESHOLDS["nfl"], {"unit": "weeks", "min_periods": 6, "min_props": 1500})

    def test_dumps_roundtrip(self):
        for data in ({"a": 1, "props": [{"x": 1, "y": None}, {"x": "é"}]}, {"a": 1, "props": []}, {"props": [1]},
                     {"a": {"b": [1, 2]}}):
            self.assertEqual(json.loads(C.dumps(data)), data)

    def test_write_if_changed_ignores_timestamps(self):
        with tempfile.TemporaryDirectory() as tmp:
            p = Path(tmp) / "x.json"
            self.assertTrue(C.write_json_if_changed(p, {"a": 1, "generated_at": "t1"}))
            self.assertFalse(C.write_json_if_changed(p, {"a": 1, "generated_at": "t2"}))
            self.assertTrue(C.write_json_if_changed(p, {"a": 2, "generated_at": "t3"}))


def _mk_day(root: Path, sport: str, d: date, slate: dict, recap=None, status="waiting"):
    ddir = C.day_dir(sport, d, root)
    ddir.mkdir(parents=True, exist_ok=True)
    (ddir / "slate.json").write_text(json.dumps(slate))
    (ddir / "meta.json").write_text(json.dumps({"status": status}))
    if recap is not None:
        (ddir / "recap.json").write_text(json.dumps(recap))
    return ddir


class TestDayGuards(unittest.TestCase):
    def test_guards_and_scoreboard(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            (root / "evaluation_exclusions.json").write_text(json.dumps(
                {"exclusions": [{"sport": "wnba", "slate_date": "2026-09-23"}]}))
            slate = {"slate_date": "x", "props": [s2()]}
            recap = {"props": [dict(s2(), actual=12, result="OVER", model_result="HIT")]}
            open_day = _mk_day(root, "wnba", date(2026, 9, 25), slate)
            excl = _mk_day(root, "wnba", date(2026, 9, 23), slate, recap, "complete")
            done = _mk_day(root, "wnba", date(2026, 9, 24), slate, recap, "complete")
            ex = C.exclusions(root)
            self.assertEqual(G.grade_day("wnba", date(2026, 9, 25), open_day, ex)[1], "day_not_complete")
            self.assertEqual(G.grade_day("wnba", date(2026, 9, 23), excl, ex)[1], "excluded")
            self.assertEqual(G.grade_day("wnba", date(2026, 9, 24), done, ex)[1], "no_shadow")
            raw = (done / "slate.json").read_text()
            shadow = {"status": "scored", "slate_sha256": "stale", "props": [shadow_row("A", "Points", "OVER", 13.0)]}
            (done / "shadow.json").write_text(json.dumps(shadow))
            self.assertIn("stale", G.grade_day("wnba", date(2026, 9, 24), done, ex)[1])
            shadow["slate_sha256"] = C.sha256_text(raw)[:16]
            (done / "shadow.json").write_text(json.dumps(shadow))
            before = {f: hashlib.sha256((done / f).read_bytes()).hexdigest() for f in ("slate.json", "recap.json", "meta.json")}
            out = G.run("wnba", root)
            self.assertTrue(any(o.get("action") == "written" for o in out))
            after = {f: hashlib.sha256((done / f).read_bytes()).hexdigest() for f in before}
            self.assertEqual(before, after)
            summ = json.loads((done / "shadow_summary.json").read_text())
            self.assertEqual((summ["overall"]["shadow"]["hits"], summ["overall"]["current"]["hits"]), (1, 1))
            board = json.loads((root / "wnba" / "shadow_scoreboard.json").read_text())
            self.assertEqual(board["graded_days"], ["2026-09-24"])
            self.assertEqual(board["status"], "collecting")
            self.assertEqual(board["progress"], {"periods": "1/20", "props": "1/1500"})
            self.assertFalse((excl / "shadow_summary.json").exists())
            self.assertFalse((open_day / "shadow_summary.json").exists())


def _have(rev: str) -> bool:
    return subprocess.run(["git", "-C", str(REPO), "cat-file", "-e", f"{rev}^{{commit}}"],
                          capture_output=True).returncode == 0


class TestIntegrationRealMemory(unittest.TestCase):
    """Uses the committed KBO memory days and git history (skips on shallow clones)."""

    def test_pinned_inputs_reproduce_published_kbo_projections(self):
        slate_path = REPO / "memory/kbo/09/25/2026/slate.json"
        if not slate_path.exists() or not _have("f209f1fa72aa"):
            self.skipTest("needs memory/kbo/09/25/2026 and commit f209f1fa72aa")
        from ml.kbo.replay import load_pitcher_games
        from ml.shadow.projectors import KboProjector
        live = {"dedupe": "fixed", "form": "live", "shrink_games": 6.0, "weights": "live", "opp_mult": 1.0}
        pm = {s: {"formula": {"knobs": dict(live)}, "linear_calibration": None}
              for s in ("Strikeouts", "Hits Allowed", "Pitching Outs")}
        pm["Hits+Runs+RBIs"] = {"formula": {"knobs": {"pa_weights": "live", "rate_weights": "live", "opp": "published",
                                                      "park": True, "split": True, "pitcher": True}},
                                "linear_calibration": None}
        hist = C.History(REPO)
        kp = KboProjector(hist, pm)
        slate = json.loads(slate_path.read_text())
        d = date(2026, 9, 25)
        n = ok = 0
        for prop in slate["props"]:
            stat = C.params_stat("kbo", prop["stat"])
            if stat not in pm:
                continue
            sha, _ = C.pin_prop("kbo", d, slate, prop, hist)
            data = kp._load(sha)
            data["pitchers"] = load_pitcher_games(hist.repo(sha), "live")  # live double-count dedupe
            data["all_pitcher_games"] = [g for gs in data["pitchers"].values() for g in gs]
            kp._league.clear()
            v, _ = kp.project(stat, prop, d, sha)
            if v is None:
                continue
            n += 1
            ok += abs(v - prop["projection"]) <= 0.011
        self.assertGreaterEqual(n, 25)
        self.assertGreaterEqual(ok / n, 0.95)

    def test_backfill_kbo_0924_matches_summary_and_is_read_only(self):
        day = REPO / "memory/kbo/09/24/2026"
        if not (day / "recap.json").exists() or not _have("b1b9ae719"):
            self.skipTest("needs memory/kbo/09/24/2026 and its pregame commit")
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp) / "memory"
            shutil.copytree(REPO / "memory", root, ignore=shutil.ignore_patterns("shadow*.json"))
            tday = root / "kbo/09/24/2026"
            before = {f: hashlib.sha256((tday / f).read_bytes()).hexdigest()
                      for f in ("slate.json", "recap.json", "summary.json", "meta.json")}
            S.run("kbo", root, only=date(2026, 9, 24))
            G.run("kbo", root, only=date(2026, 9, 24))
            after = {f: hashlib.sha256((tday / f).read_bytes()).hexdigest() for f in before}
            self.assertEqual(before, after)
            shadow = json.loads((tday / "shadow.json").read_text())
            self.assertEqual(shadow["status"], "scored")
            self.assertTrue(all(r["input_ref"] == shadow["props"][0]["input_ref"] for r in shadow["props"]))
            summ = json.loads((tday / "shadow_summary.json").read_text())
            ref = json.loads((tday / "summary.json").read_text())
            cur = summ["overall"]["current"]
            self.assertEqual((cur["hits"], cur["misses"], cur["pushes"], cur["dnps"]),
                             (ref["hits"], ref["misses"], ref["pushes"], ref["dnps"]))
            self.assertEqual(cur["hit_rate_pct"], ref["hit_rate_pct"])
            # pinned inputs -> deterministic re-score
            first = [r["shadow_projection"] for r in shadow["props"]]
            S.run("kbo", root, only=date(2026, 9, 24), force=True)
            again = [r["shadow_projection"] for r in json.loads((tday / "shadow.json").read_text())["props"]]
            self.assertEqual(first, again)


class TestWorkflowAndIsolation(unittest.TestCase):
    wf = REPO / ".github/workflows/ml-shadow.yml"

    def test_schedule_and_publish(self):
        text = self.wf.read_text()
        crons = re.findall(r'cron:\s*"([^"]+)"', text)
        self.assertGreaterEqual(len(crons), 4)
        for c in crons:
            self.assertNotIn(c.split()[0], ("0", "00", "30"), c)
        self.assertIn("ml/shadow/publish_shadow.sh", text)
        self.assertIn("group: ml-shadow", text)
        for forbidden in ("commit_memory.sh", "git push", "pipeline/memory/freeze", "pipeline/memory/grade", "npm "):
            self.assertNotIn(forbidden, text)

    def test_deploy_ignores_memory_and_ml_workflows(self):
        text = (REPO / ".github/workflows/deploy.yml").read_text()
        paths = text.split("paths:", 1)[1].split("schedule:", 1)[0]
        entries = re.findall(r'-\s*"([^"]+)"', paths)
        self.assertFalse(any(e.startswith("memory") for e in entries))
        self.assertEqual(entries[-3:], ["!ml/**", "!.github/workflows/ml-*.yml", "!.github/workflows/ml-*.yaml"])

    def test_live_code_never_imports_shadow(self):
        for base in ("pipeline", "kbo-props-ui/src", "wnba", "nfl"):
            root = REPO / base
            if not root.exists():
                continue
            for f in root.rglob("*"):
                if f.suffix in (".py", ".js", ".jsx", ".ts", ".tsx") and "node_modules" not in f.parts:
                    t = f.read_text(errors="ignore")
                    self.assertNotIn("ml.shadow", t, str(f))
                    self.assertNotIn("shadow.json", t, str(f))

    def test_publish_script_only_pushes_shadow_files(self):
        if shutil.which("git") is None:
            self.skipTest("git missing")
        script = REPO / "ml/shadow/publish_shadow.sh"
        with tempfile.TemporaryDirectory() as tmp:
            run = lambda *a, cwd=tmp: subprocess.run(a, cwd=cwd, capture_output=True, text=True, check=True)
            run("git", "init", "-q", "--bare", "origin.git")
            run("git", "clone", "-q", "origin.git", "work")
            w = str(Path(tmp) / "work")
            run("git", "checkout", "-q", "-b", "main", cwd=w)
            day = Path(w) / "memory/kbo/09/24/2026"
            day.mkdir(parents=True)
            (day / "slate.json").write_text("{}")
            run("git", "add", ".", cwd=w)
            run("git", "-c", "user.name=t", "-c", "user.email=t@t", "commit", "-qm", "init", cwd=w)
            run("git", "push", "-q", "origin", "main", cwd=w)
            (day / "shadow.json").write_text('{"a": 1}')
            (day / "shadow_summary.json").write_text('{"b": 1}')
            (Path(w) / "memory/kbo/shadow_scoreboard.json").write_text('{"c": 1}')
            (day / "slate.json").write_text('{"changed": true}')
            (day / "recap.json").write_text("{}")
            (Path(w) / "other.txt").write_text("x")
            res = subprocess.run(["bash", str(script), "chore: test"], cwd=w, capture_output=True, text=True)
            self.assertEqual(res.returncode, 0, res.stdout + res.stderr)
            files = run("git", "--git-dir", str(Path(tmp) / "origin.git"), "show", "--name-only", "--format=", "main").stdout.split()
            self.assertEqual(sorted(files), ["memory/kbo/09/24/2026/shadow.json", "memory/kbo/09/24/2026/shadow_summary.json",
                                             "memory/kbo/shadow_scoreboard.json"])


if __name__ == "__main__":
    unittest.main()

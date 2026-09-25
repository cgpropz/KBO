"""KBO Phase 2 candidates: point-in-time projections of every knob combination
for every dataset row, packaged as walk-forward Problems (ml/common/walkforward.py).

Pitchers (Strikeouts, Hits Allowed, Pitching Outs), full replay of ml/kbo/formula.py:
  dedupe       live (round(ip,3) double-count bug) | fixed
  form         live clamp .90-1.10 | narrow .95-1.05 | off
  shrink_games 6 (live) | 3 | 10
  weights      recency blend used for SO/IP, IP/G and H/IP
  opp_mult     multiplier on the opponent-factor sensitivity: 1 (live) | 0 (off) | 1.5
Batters, Hits+Runs+RBIs (PA-decomposition base replayed; multipliers):
  pa_weights, rate_weights  recency blends
  opp          published (opponent's OWN batting HRR/G, the live input) |
               corrected (opponent pitching staff's HRR allowed per game, rebuilt
               point in time from batting logs before the date) | off
  park / split / pitcher    on | off (published multipliers)
Total Bases, Fantasy Score: not replayed; only the linear calibration is tuned on
the published projection.

Candidate 0 is always the CURRENT live formula.
"""
from __future__ import annotations

import csv
import io
import itertools
from collections import defaultdict
from datetime import date

from ml.common.util import GitRepo, norm_name, parse_date, to_float
from ml.common.walkforward import Problem
from ml.kbo import formula
from ml.kbo.replay import BATTING, load_batter_games, load_pitcher_games, name_map

PITCHER_PROPS = ("Strikeouts", "Hits Allowed", "Pitching Outs")
PROB_ODDS_TYPES = ("standard", "unknown")  # early batter snapshots had no odds_type; standard only

# Pre-registered single-knob variants (D5 candidates), evaluated without any selection.
VARIANTS = {
    "pitcher": {"double-count fixed": {"dedupe": "fixed"}, "form off": {"form": "off"},
                "double-count fixed + form off": {"dedupe": "fixed", "form": "off"}},
    "Hits+Runs+RBIs": {"opp factor corrected (pitching allowed)": {"opp": "corrected"}, "opp factor off": {"opp": "off"}},
}


def variants_for(stat: str) -> dict:
    return VARIANTS["pitcher"] if stat in PITCHER_PROPS else VARIANTS.get(stat, {})


PITCHER_WEIGHTS = {
    "live": (0.50, 0.30, 0.20),
    "balanced": (0.30, 0.30, 0.40),
    "season_heavy": (0.20, 0.20, 0.60),
    "recent_heavy": (0.70, 0.20, 0.10),
    "long_run": (0.10, 0.20, 0.70),
}
FORM = {"live": (0.90, 1.10), "narrow": (0.95, 1.05), "off": None}
HRR_PA_W = {"live": (0.50, 0.30, 0.20), "balanced": (0.34, 0.33, 0.33), "season_heavy": (0.20, 0.30, 0.50)}
HRR_RATE_W = {"live": (0.30, 0.30, 0.40), "season_lean": (0.20, 0.30, 0.50), "season_heavy": (0.10, 0.20, 0.70)}


def pitcher_candidates() -> list[tuple[str, dict]]:
    grid = itertools.product(("live", "fixed"), FORM, (6.0, 3.0, 10.0), PITCHER_WEIGHTS, (1.0, 0.0, 1.5))
    out = []
    for dedupe, form, shrink, weights, opp in grid:
        knobs = {"dedupe": dedupe, "form": form, "shrink_games": shrink, "weights": weights, "opp_mult": opp}
        name = f"dedupe={dedupe},form={form},shrink={shrink:g},weights={weights},opp_mult={opp:g}"
        out.append((name, knobs))
    return out  # first entry is the live formula


def hrr_candidates() -> list[tuple[str, dict]]:
    grid = itertools.product(HRR_PA_W, HRR_RATE_W, ("published", "corrected", "off"), (True, False), (True, False), (True, False))
    out = []
    for pa_w, rate_w, opp, park, split, pitcher in grid:
        knobs = {"pa_weights": pa_w, "rate_weights": rate_w, "opp": opp, "park": park, "split": split, "pitcher": pitcher}
        name = f"pa={pa_w},rate={rate_w},opp={opp},park={'on' if park else 'off'},split={'on' if split else 'off'},pitcher={'on' if pitcher else 'off'}"
        out.append((name, knobs))
    return out


# -- pitchers --


def _ratio(rows, key):
    ip = sum(g["ip"] for g in rows)
    return sum(g.get(key, 0) for g in rows) / ip if ip > 0 else None


def _ipg(rows):
    return sum(g["ip"] for g in rows) / len(rows) if rows else None


def pitcher_components(prior: list[dict], season: int = 2026) -> dict | None:
    """Everything summarize_games() needs that does not depend on the knobs (prior newest first)."""
    if not prior:
        return None
    recent, recent_ip = prior[:5], prior[:3]
    season_rows = [g for g in prior if g.get("season") == season] or prior
    return {
        "n": len(prior),
        "so": (_ratio(recent, "so"), _ratio(season_rows, "so"), _ratio(prior, "so")),
        "ha": (_ratio(recent, "ha"), _ratio(season_rows, "ha"), _ratio(prior, "ha")),
        "ip": (_ipg(recent_ip), _ipg(season_rows), _ipg(prior)),
    }


def _blend(vals, w):
    return formula.weighted_blend(list(zip(vals, w)))


def pitcher_project(prop: str, comp: dict, league: tuple, ctx: tuple, k: dict) -> float:
    """Same math as formula.summarize_games + pitcher_projections, with the knobs in k."""
    p = formula.DEFAULT_PARAMS["pitcher"]
    lg_soip, lg_ipg, lg_hip = league
    opp_so, lg_so, opp_h, lg_h = ctx
    shrink = min(1.0, comp["n"] / k["shrink_games"])
    w = PITCHER_WEIGHTS[k["weights"]]
    ipg = (_blend(comp["ip"], w) or lg_ipg) * shrink + lg_ipg * (1 - shrink)

    def form(pair):
        if k["form"] == "off" or FORM[k["form"]] is None:
            return 1.0
        recent, season = pair
        ratio = recent / season if recent and season and season > 0 else None
        return formula.clamp(ratio if ratio else 1.0, *FORM[k["form"]])

    h_ratio = opp_h / lg_h - 1.0
    if prop == "Strikeouts":
        soip = (_blend(comp["so"], w) or lg_soip) * shrink + lg_soip * (1 - shrink)
        opp = formula.clamp(1.0 + k["opp_mult"] * p["k_opp_sens"] * (opp_so / lg_so - 1.0), *p["k_opp_clamp"])
        return formula.clamp(soip * ipg * opp * form(comp["so"][:2]), *p["k_clamp"])
    if prop == "Hits Allowed":
        hip = (_blend(comp["ha"], w) or lg_hip) * shrink + lg_hip * (1 - shrink)
        opp = formula.clamp(1.0 + k["opp_mult"] * p["h_opp_sens"] * h_ratio, *p["h_opp_clamp"])
        return formula.clamp(hip * ipg * opp * form(comp["ha"][:2]), *p["h_clamp"])
    opp = formula.clamp(1.0 + k["opp_mult"] * p["outs_opp_sens"] * h_ratio, *p["outs_opp_clamp"])
    return formula.clamp(ipg * 3.0 * opp * form(comp["ip"][:2]), *p["outs_clamp"])


# -- batters: HRR --


def hrr_windows(prior: list[dict]) -> dict | None:
    if not prior:
        return None

    def window(n=None):
        sub = prior if n is None else prior[:n]
        return {"g": len(sub), "pa": sum(g["AB"] + g["Walks"] + g["HBP"] for g in sub), "h": sum(g["H"] for g in sub),
                "r": sum(g["R"] for g in sub), "rbi": sum(g["RBI"] for g in sub)}

    return {"s": window(), "l6": window(6), "l3": window(3)}


def hrr_project(win: dict, factors: dict, k: dict) -> float:
    """Same math as formula.hrr_base + hrr_projection, with the knobs in k."""
    def div(a, b):
        return a / b if b > 0 else None

    def weighted(vals, w):
        tot = tw = 0.0
        for v, wt in zip(vals, w):
            if v is None:
                continue
            tot += v * wt
            tw += wt
        return tot / tw if tw > 0 else None

    s, l6, l3 = win["s"], win["l6"], win["l3"]
    proj_pa = weighted((div(l3["pa"], l3["g"]), div(l6["pa"], l6["g"]), div(s["pa"], s["g"])), HRR_PA_W[k["pa_weights"]])
    rates = [weighted((div(l3[x], l3["pa"]), div(l6[x], l6["pa"]), div(s[x], s["pa"])), HRR_RATE_W[k["rate_weights"]]) or 0.0
             for x in ("h", "r", "rbi")]
    base = proj_pa * sum(rates) if proj_pa and proj_pa > 0 else (s["h"] + s["r"] + s["rbi"]) / s["g"]

    def f(v):
        v = to_float(v)
        return v if v is not None else 1.0

    opp = {"published": f(factors.get("opp_factor")), "corrected": factors.get("opp_corrected", 1.0), "off": 1.0}[k["opp"]]
    return (base * opp * (f(factors.get("park_factor")) if k["park"] else 1.0)
            * (f(factors.get("split_factor")) if k["split"] else 1.0)
            * (f(factors.get("pitcher_factor")) if k["pitcher"] else 1.0))


class OppAllowed:
    """Point-in-time HRR allowed per game by each team's pitching staff (from batting logs)."""

    def __init__(self, git: GitRepo, season: int = 2026):
        games: dict = defaultdict(float)  # (date, batting team, opponent) -> team HRR in that game
        for r in csv.DictReader(io.StringIO(git.file_at_ref(BATTING))):
            if str(r.get("Season", "")) != str(season):
                continue
            d = parse_date(r.get("DATE"))
            if not d:
                continue
            i = lambda key: int(float(r.get(key) or 0))
            games[(d, str(r.get("Team") or "").strip(), str(r.get("OPP") or "").strip())] += i("H") + i("R") + i("RBI")
        self.games = sorted(games.items())
        self.cache: dict = {}

    def factor(self, day: date, opp: str, sens: float = 0.50, lo: float = 0.88, hi: float = 1.12) -> float:
        if day not in self.cache:
            tot, cnt = defaultdict(float), defaultdict(int)
            for (d, _team, o), hrr in self.games:
                if d >= day:
                    break
                tot[o] += hrr
                cnt[o] += 1
            n = sum(cnt.values())
            league = sum(tot.values()) / n if n else None
            self.cache[day] = ({o: tot[o] / cnt[o] for o in tot if cnt[o] >= 5}, league)
        rates, league = self.cache[day]
        from ml.kbo.build_dataset import canon_team
        rate = next((v for o, v in rates.items() if canon_team(o) == canon_team(opp)), None)
        if not rate or not league:
            return 1.0
        return formula.clamp(1.0 + sens * (rate / league - 1.0), lo, hi)


# -- problems --


def _unique_rows(rows: list[dict], prop: str) -> list[dict]:
    """One row per (date, player, prop) for MAE tuning; prefer the standard line."""
    best: dict = {}
    for r in rows:
        if r["prop"] != prop:
            continue
        key = (r["date"], norm_name(r["player"]))
        if key not in best or (r["odds_type"] in PROB_ODDS_TYPES and best[key]["odds_type"] not in PROB_ODDS_TYPES):
            best[key] = r
    return [best[k] for k in sorted(best)]


def _prob_rows(rows: list[dict], prop: str, key_index: dict) -> list[dict]:
    out, seen = [], set()
    for r in rows:
        if r["prop"] != prop or r["odds_type"] not in PROB_ODDS_TYPES:
            continue
        key = (r["date"], norm_name(r["player"]))
        if key in seen or key not in key_index:
            continue
        seen.add(key)
        out.append({"i": key_index[key], "line": float(r["line"]), "actual": float(r["actual"]), "period": r["date"]})
    return out


def _games_before(games, day):
    return sorted((g for g in games if g["date"] < day), key=lambda g: g["date"], reverse=True)


def build_problems(rows: list[dict], git: GitRepo) -> list[tuple[Problem, list[dict]]]:
    nmap = name_map(git)
    out = []
    # pitchers
    games = {d: load_pitcher_games(git, d) for d in ("live", "fixed")}
    all_games = {d: [g for gs in games[d].values() for g in gs] for d in games}
    league_cache: dict = {}
    cands = pitcher_candidates()
    for prop in PITCHER_PROPS:
        prows, comps, ctxs = [], [], []
        for r in _unique_rows(rows, prop):
            ctx = tuple(to_float(r.get(c)) for c in ("ctx_opp_so_per_g", "ctx_league_avg_so_per_g",
                                                     "ctx_opp_h_per_ip", "ctx_league_avg_h_per_ip"))
            if any(v is None or v == 0 for v in ctx):
                continue
            day = parse_date(r["date"])
            key = norm_name(r["player"])
            comp = {}
            for d in ("live", "fixed"):
                gs = next((games[d][k] for k in (key, nmap.get(key, "")) if k and k in games[d]), None)
                prior = _games_before(gs, day) if gs else []
                if (d, day) not in league_cache:
                    league_cache[(d, day)] = formula.league_rates([g for g in all_games[d] if g["date"] < day])
                comp[d] = (pitcher_components(prior), league_cache[(d, day)])
            if comp["live"][0] is None or comp["fixed"][0] is None:
                continue
            prows.append(r)
            comps.append(comp)
            ctxs.append(ctx)
        preds = [[round(pitcher_project(prop, c[k["dedupe"]][0], c[k["dedupe"]][1], x, k), 4) for c, x in zip(comps, ctxs)]
                 for _, k in cands]
        out.append(_problem(prop, prows, cands, preds, rows))
    # batters: HRR
    bat = load_batter_games(git)
    opp_allowed = OppAllowed(git)
    hcands = hrr_candidates()
    prows, wins, facs = [], [], []
    for r in _unique_rows(rows, "Hits+Runs+RBIs"):
        day = parse_date(r["date"])
        key = norm_name(r["player"])
        gs = next((bat[k] for k in (key, nmap.get(key, "")) if k and k in bat), None)
        win = hrr_windows(_games_before(gs, day) if gs else [])
        if win is None:
            continue
        fac = {k: r.get(k) for k in ("opp_factor", "park_factor", "split_factor", "pitcher_factor")}
        fac["opp_corrected"] = opp_allowed.factor(day, r["opp"])
        prows.append(r)
        wins.append(win)
        facs.append(fac)
    preds = [[round(hrr_project(w, f, k), 4) for w, f in zip(wins, facs)] for _, k in hcands]
    out.append(_problem("Hits+Runs+RBIs", prows, hcands, preds, rows))
    # not replayed: calibration only on the published projection
    for prop in ("Total Bases", "Fantasy Score"):
        prows = _unique_rows(rows, prop)
        preds = [[float(r["projection"]) for r in prows]]
        out.append(_problem(prop, prows, [("published (not replayed)", {"source": "published"})], preds, rows))
    return out


def _problem(prop, prows, cands, preds, all_rows):
    keys = [(r["date"], norm_name(r["player"])) for r in prows]
    problem = Problem(
        sport="kbo", stat=prop, periods=[r["date"] for r in prows], actual=[float(r["actual"]) for r in prows],
        published=[float(r["projection"]) for r in prows], candidates=cands, preds=preds, keys=keys,
    )
    return problem, _prob_rows(all_rows, prop, {k: i for i, k in enumerate(keys)})


def load_rows(path) -> list[dict]:
    with open(path, encoding="utf-8") as handle:
        return list(csv.DictReader(handle))


def resolve_knobs(knobs: dict) -> dict:
    """Knob names -> the numbers they stand for (for the params JSON)."""
    out = dict(knobs)
    if "weights" in out:
        out["weights"] = {"name": knobs["weights"], "recent_season_all": PITCHER_WEIGHTS[knobs["weights"]]}
    if "form" in out:
        out["form"] = {"name": knobs["form"], "clamp": FORM[knobs["form"]]}
    if "pa_weights" in out:
        out["pa_weights"] = {"name": knobs["pa_weights"], "l3_l6_season": HRR_PA_W[knobs["pa_weights"]]}
    if "rate_weights" in out:
        out["rate_weights"] = {"name": knobs["rate_weights"], "l3_l6_season": HRR_RATE_W[knobs["rate_weights"]]}
    return out

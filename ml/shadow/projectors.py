"""Per-sport "final fit" projections from the Phase 2 params (knobs + linear
calibration), computed from inputs pinned at a pregame git ref.

Each projector returns (fit_projection or None, note). The fit projection is
what params/<sport>/<stat>.json describes (formula.knobs, then
linear_calibration); it is also the projection the P(over) calibrator was
trained on. The scorer decides whether it becomes the shadow projection
(recommendation == "candidate") or the current projection is carried instead.
"""
from __future__ import annotations

import csv
import re
from collections import defaultdict
from datetime import date
from pathlib import Path

from ml.common.util import ML_ROOT, norm_name, to_float
from ml.shadow.common import History, linear

KBO_PITCHER_PAYLOAD = "kbo-props-ui/public/data/strikeout_projections.json"
WNBA_BOARDS = {t: f"kbo-props-ui/public/data/wnba/projections_{t}.json" for t in ("standard", "goblin", "demon")}


def current_projection_valid(sport: str, prop: dict) -> tuple[bool, str]:
    """Is the slate `projection` a real stat projection (usable for MAE / edge)?"""
    proj, line = to_float(prop.get("projection")), to_float(prop.get("line"))
    if proj is None or line is None:
        return False, "no_projection_or_line"
    if sport == "kbo" and prop.get("role") == "pitcher" and int(prop.get("projection_schema") or 0) < 2:
        return False, "legacy_kbo_pitcher_cg_score"
    if sport == "nfl":
        fb = prop.get("projection_is_line_fallback")
        if fb is True or (fb is None and proj == line):
            return False, "nfl_line_fallback(<3 games)"
    return True, ""


# -- KBO --


class KboProjector:
    def __init__(self, hist: History, params: dict[str, dict]):
        self.hist, self.params = hist, params
        self._data: dict = {}
        self._league: dict = {}

    def _load(self, sha: str) -> dict:
        if sha not in self._data:
            from ml.kbo.replay import load_batter_games, load_pitcher_games, name_map
            from ml.kbo.tune import OppAllowed
            git = self.hist.repo(sha)
            pitchers = load_pitcher_games(git, "fixed")
            self._data = {sha: {  # keep one ref in memory at a time
                "pitchers": pitchers, "all_pitcher_games": [g for gs in pitchers.values() for g in gs],
                "batters": load_batter_games(git), "nmap": name_map(git), "opp": OppAllowed(git),
                "payload": git.show_json(sha, KBO_PITCHER_PAYLOAD) or {},
            }}
        return self._data[sha]

    def _games(self, table: dict, nmap: dict, player: str):
        key = norm_name(player)
        return next((table[k] for k in (key, nmap.get(key, "")) if k and k in table), None)

    def project(self, stat: str, prop: dict, d: date, sha: str) -> tuple[float | None, str]:
        from ml.kbo import formula
        from ml.kbo.build_dataset import snapshot_context
        from ml.kbo.tune import PITCHER_PROPS, _games_before, hrr_project, hrr_windows, pitcher_components, pitcher_project
        p = self.params[stat]
        knobs, cal = p["formula"]["knobs"], p.get("linear_calibration")
        if knobs.get("source") == "published":
            ok, why = current_projection_valid("kbo", prop)
            return (linear(cal, float(prop["projection"])), "published_x_calibration") if ok else (None, why)
        data = self._load(sha)
        if stat in PITCHER_PROPS:
            if knobs.get("dedupe") != "fixed":
                return None, "unsupported_knob(dedupe)"
            gs = self._games(data["pitchers"], data["nmap"], prop.get("player"))
            comp = pitcher_components(_games_before(gs, d)) if gs else None
            if comp is None:
                return None, "no_prior_pitcher_games"
            if (sha, d) not in self._league:
                self._league[(sha, d)] = formula.league_rates([g for g in data["all_pitcher_games"] if g["date"] < d])
            ctx = snapshot_context(data["payload"], {"opponent": prop.get("opponent")})
            ctx = tuple(to_float(ctx[c]) for c in ("ctx_opp_so_per_g", "ctx_league_avg_so_per_g",
                                                   "ctx_opp_h_per_ip", "ctx_league_avg_h_per_ip"))
            if any(v is None or v == 0 for v in ctx):
                return None, "no_opponent_context"
            return linear(cal, pitcher_project(stat, comp, self._league[(sha, d)], ctx, knobs)), "replayed"
        if stat == "Hits+Runs+RBIs":
            gs = self._games(data["batters"], data["nmap"], prop.get("player"))
            win = hrr_windows(_games_before(gs, d)) if gs else None
            if win is None:
                return None, "no_prior_batter_games"
            factors = dict(prop.get("factors") or {})
            needs = [k for k in ("park", "split", "pitcher") if knobs.get(k)] + (["opp"] if knobs.get("opp") == "published" else [])
            if any(factors.get(f"{k}_factor") is None for k in needs):
                return None, "missing_published_factors"
            factors["opp_corrected"] = data["opp"].factor(d, prop.get("opponent"))
            return linear(cal, hrr_project(win, factors, knobs)), "replayed"
        return None, "no_projector"


# -- WNBA --


class WnbaProjector:
    def __init__(self, hist: History, params: dict[str, dict]):
        self.hist, self.params = hist, params
        self._data: dict = {}

    def _load(self, sha: str) -> dict:
        if sha not in self._data:
            from ml.wnba.replay import load_gamelogs
            git = self.hist.repo(sha)
            boards = {t: git.show_json(sha, path) or [] for t, path in WNBA_BOARDS.items()}
            self._data = {sha: {"logs": load_gamelogs(git), "boards": boards}}
        return self._data[sha]

    def _dvp(self, data: dict, player: str, odds_type: str, d: date) -> dict | None:
        from ml.common.util import parse_date
        name = str(player or "").strip().lower()
        order = [odds_type] + [t for t in WNBA_BOARDS if t != odds_type]
        fallback = None
        for t in order:
            for pl in data["boards"].get(t) or []:
                if str(pl.get("name") or "").strip().lower() != name:
                    continue
                if any(parse_date(x.get("gameDate")) == d for x in pl.get("ppAllProps") or []):
                    return pl.get("dvpFactors") or {}
                fallback = fallback if fallback is not None else (pl.get("dvpFactors") or {})
        return fallback

    def project(self, stat: str, prop: dict, d: date, sha: str) -> tuple[float | None, str]:
        from ml.wnba import formula
        from ml.wnba.tune import RowFeatures, components_for, project
        p = self.params[stat]
        knobs, cal = p["formula"]["knobs"], p.get("linear_calibration")
        if formula.LABEL_TO_KEY.get(stat) is None:
            return None, "unsupported_stat"
        data = self._load(sha)
        games = [g for g in data["logs"].get(str(prop.get("player") or "").strip().lower(), []) if g["date"] < d]
        if not games:
            return None, "no_prior_games"
        note = "replayed"
        dvp = {}
        if knobs.get("dvp") != "off":
            dvp = self._dvp(data, prop.get("player"), str(prop.get("odds_type") or "standard"), d)
            if dvp is None:
                dvp, note = {}, "replayed(dvp_missing->1.0)"
        return linear(cal, project(stat, RowFeatures(games, components_for(stat), dvp), knobs)), note


# -- NFL --


def nfl_name_key(name) -> str:
    """Same as nfl/build_projection_data.py name_key."""
    stripped = re.sub(r"\s+(jr|sr|ii|iii|iv|v)\.?$", "", str(name).lower().strip())
    return re.sub(r"[^a-z0-9]", "", stripped)


class NflValues:
    """Prior per-game values from nflverse weekly stats (REG+POST), keyed like the live pipeline."""

    def __init__(self, data_dir: Path | None = None, seasons=(2024, 2025, 2026), refresh_current: bool = False):
        self.data_dir = Path(data_dir or ML_ROOT / "data" / "nfl")
        self.seasons = tuple(seasons)
        self.refresh_current = refresh_current
        self._by_key: dict | None = None
        self.error: str | None = None

    def _build(self) -> dict:
        from ml.nfl.replay import GAMES_URL, STATS_URL, fetch
        if self.refresh_current:
            for name in ("games.csv", f"stats_player_week_{max(self.seasons)}.csv"):
                (self.data_dir / name).unlink(missing_ok=True)
        games = {}
        with fetch(GAMES_URL, self.data_dir / "games.csv").open(encoding="utf-8") as handle:
            for g in csv.DictReader(handle):
                if int(g["season"]) in self.seasons:
                    for side in ("away_team", "home_team"):
                        games[(int(g["season"]), int(g["week"]), g[side])] = g["gameday"]
        by_key: dict = defaultdict(lambda: defaultdict(list))
        for season in self.seasons:
            try:
                path = fetch(STATS_URL.format(season=season), self.data_dir / f"stats_player_week_{season}.csv")
            except Exception:  # noqa: BLE001 - a season file may not exist yet
                continue
            with path.open(encoding="utf-8") as handle:
                for r in csv.DictReader(handle):
                    if r.get("season_type") not in ("REG", "POST"):
                        continue
                    day = games.get((int(r["season"]), int(r["week"]), r["team"]))
                    if day:
                        r["gameday"] = day
                        by_key[nfl_name_key(r.get("player_display_name"))][r["player_id"]].append(r)
        return by_key

    def values(self, player: str, team: str | None, stat: str, d: date) -> tuple[list[float] | None, str]:
        from ml.nfl.replay import stat_value
        if self._by_key is None:
            try:
                self._by_key = self._build()
            except Exception as exc:  # noqa: BLE001 - network / parse failure -> carry current
                self._by_key, self.error = {}, f"nflverse_unavailable: {exc}"[:200]
        if self.error:
            return None, self.error
        ids = self._by_key.get(nfl_name_key(player)) or {}
        cands = []
        for logs in ids.values():
            prior = sorted((r for r in logs if r["gameday"] < d.isoformat()), key=lambda r: r["gameday"])
            if prior:
                cands.append(prior)
        if len(cands) > 1 and team:
            cands = [c for c in cands if str(c[-1].get("team") or "").upper() == str(team).upper()] or cands
        if not cands:
            return None, "no_prior_games"
        if len(cands) > 1:
            return None, "ambiguous_player_name"
        return [stat_value(r, stat) for r in cands[0]][-30:], "nflverse"


class NflProjector:
    def __init__(self, hist: History, params: dict[str, dict], values: NflValues | None = None):
        self.hist, self.params = hist, params
        self.values = values or NflValues()

    def project(self, stat: str, prop: dict, d: date, sha: str) -> tuple[float | None, str]:
        from ml.nfl import formula
        from ml.nfl.tune import params_for
        p = self.params[stat]
        knobs, cal = p["formula"]["knobs"], p.get("linear_calibration")
        if p["formula"].get("is_current"):
            ok, why = current_projection_valid("nfl", prop)
            return (linear(cal, float(prop["projection"])), "current_x_calibration") if ok else (None, why)
        vals, src = self.values.values(prop.get("player"), prop.get("team"), stat, d)
        if vals is None:
            return None, src
        proj = formula.projection(vals, params_for(knobs))
        if proj is None:
            return None, "fewer_than_3_prior_games"
        return linear(cal, proj), "replayed(nflverse<gameday)"


def make_projector(sport: str, hist: History, params: dict[str, dict], nfl_values: NflValues | None = None):
    if sport == "kbo":
        return KboProjector(hist, params)
    if sport == "wnba":
        return WnbaProjector(hist, params)
    return NflProjector(hist, params, nfl_values)

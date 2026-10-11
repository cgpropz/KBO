#!/usr/bin/env python3
"""Write docs/live_formulas.md and docs/live_formulas.html from ml/params.

Coefficients are read from the committed params files. Nothing here is typed by hand.
"""
from __future__ import annotations

import html
import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from pipeline.live_formula import CONFIG_PATH, file_mode, load_params  # noqa: E402

SPORTS = ("kbo", "wnba", "nfl")

DOCS = Path(__file__).resolve().parents[1] / "docs"

KNOB_PLAIN = {
    "dedupe": {
        "fixed": "each start is counted once (the old feed double-counted starts whose innings did not match to 3 decimals)",
        "live": "the previous dedupe, which can count one start twice",
    },
    "form": {
        "off": "recent-form multiplier is turned off (always 1)",
        "live": "recent/season ratio, clamped between 0.90 and 1.10",
        "narrow": "recent/season ratio, clamped between 0.95 and 1.05",
    },
    "weights": {
        "live": "50% recent, 30% this season, 20% all starts",
        "balanced": "30% recent, 30% this season, 40% all starts",
        "season_heavy": "20% recent, 20% this season, 60% all starts",
        "recent_heavy": "70% recent, 20% this season, 10% all starts",
        "long_run": "10% recent, 20% this season, 70% all starts",
        "long_heavy": "more weight on the longest window (see that sport's weight table)",
    },
    "opp_mult": "multiplier on how strongly the opponent's offense moves the projection (1 = previous sensitivity, 0 = ignore the opponent, 1.5 = one and a half times as sensitive)",
    "shrink_games": "starts needed before the pitcher's own rate fully replaces the league rate",
    "pa_weights": {
        "live": "plate appearances: 50% last 3 games, 30% last 6, 20% season",
        "balanced": "plate appearances: about one third each of last 3, last 6, and season",
        "season_heavy": "plate appearances: 20% last 3, 30% last 6, 50% season",
    },
    "rate_weights": {
        "live": "hits, runs, and RBI per plate appearance: 30% last 3, 30% last 6, 40% season",
        "season_lean": "those rates: 20% last 3, 30% last 6, 50% season",
        "season_heavy": "those rates: 10% last 3, 20% last 6, 70% season",
    },
    "opp": {
        "published": "opponent's own batting (the previous input)",
        "corrected": "how many hits+runs+RBI that team's pitchers have allowed, versus the league",
        "off": "opponent multiplier turned off",
    },
    "window_weights": {
        "live": "50% shortest window, 30% middle, 20% longest",
        "balanced": "about one third on each window",
        "long_heavy": "20% shortest, 30% middle, 50% longest",
        "short_heavy": "60% shortest, 30% middle, 10% longest",
        "mid_heavy": "30% shortest, 50% middle, 20% longest",
    },
    "windows": {
        "live": "last 3, 7, and 15 games (WNBA) or last 3, 9, and 15 (NFL)",
        "longer": "last 5, 10, and 20 games",
        "longest": "last 7, 15, and 30 games",
        "short": "last 3, 6, and 10 games",
        "long": "last 3, 8, and 16 games",
    },
    "dvp": {
        "on": "full defense-vs-position factor",
        "half": "square root of the defense-vs-position factor (a milder adjustment)",
        "off": "defense-vs-position factor turned off",
    },
    "minutes_window": "how many recent games are averaged to project minutes",
    "recent_cap": "how many recent games are kept before the windows are applied (10 was the previous cap, so a 'last 15' window only saw 10 games)",
}

STAT_PLAIN = {
    ("kbo", "Strikeouts"): "Expected strikeouts for today's starter.",
    ("kbo", "Hits Allowed"): "Expected hits allowed by today's starter.",
    ("kbo", "Pitching Outs"): "Expected outs recorded (innings pitched times 3).",
    ("kbo", "Hits+Runs+RBIs"): "Expected hits plus runs plus RBI for the batter.",
    ("kbo", "Fantasy Score"): "The published fantasy-score projection, then shifted with a straight line.",
    ("kbo", "Total Bases"): "Expected total bases. This one was not promoted.",
    ("wnba", "Points"): "Expected points from per-minute scoring, projected minutes, and the opponent's defense.",
    ("wnba", "Assists"): "Expected assists, same shape as points.",
    ("wnba", "FG Attempted"): "Expected field-goal attempts.",
    ("wnba", "Pts+Rebs"): "Expected points plus rebounds. Each piece uses this stat's own windows, then the pieces are added.",
    ("wnba", "Pts+Asts"): "Expected points plus assists.",
    ("wnba", "Rebs+Asts"): "Expected rebounds plus assists.",
    ("wnba", "Fantasy Score"): "Fantasy score from this stat's own per-minute rates for points, rebounds, assists, steals, blocks, and turnovers. It does not reuse the Points prop's formula.",
    ("nfl", "Receiving Yards"): "Expected receiving yards from the player's earlier games.",
    ("nfl", "Rush Yards"): "Expected rushing yards. The window mix stays the same; a straight line recalibrates it.",
    ("nfl", "Rush Attempts"): "Expected rush attempts. Left on the previous formula.",
    ("nfl", "Receptions"): "Expected receptions, recalibrated with a straight line.",
    ("nfl", "Rec Targets"): "Expected targets, recalibrated with a straight line.",
    ("nfl", "Pass Yards"): "Expected passing yards, recalibrated with a straight line.",
    ("nfl", "Pass Attempts"): "Expected pass attempts. Left on the previous formula.",
    ("nfl", "Pass Completions"): "Expected completions. Left on the previous formula.",
    ("nfl", "Pass+Rush Yds"): "Expected passing plus rushing yards, recalibrated with a straight line.",
    ("nfl", "Rush+Rec Yds"): "Expected rushing plus receiving yards, recalibrated with a straight line.",
}


def _fmt(value) -> str:
    if isinstance(value, float):
        text = f"{value:.6g}"
        return text
    return str(value)


def knob_sentence(sport: str, name, value) -> str:
    if name in ("park", "split", "pitcher"):
        return f"{name} multiplier is {'on' if value else 'off (treated as 1)'}"
    if sport == "nfl" and name == "weights":
        from ml.nfl.tune import WEIGHTS
        w = WEIGHTS[value]
        return f"weights = {value} — {w[0]:.0%} on the shortest window, {w[1]:.0%} on the middle, {w[2]:.0%} on the longest"
    if sport == "nfl" and name == "windows":
        from ml.nfl.tune import WINDOWS
        n = WINDOWS[value]
        return f"windows = {value} — means of the last {n[0]}, {n[1]}, and {n[2]} games"
    if sport == "kbo" and name == "weights":
        from ml.kbo.tune import PITCHER_WEIGHTS
        w = PITCHER_WEIGHTS[value]
        return f"weights = {value} — {w[0]:.0%} recent, {w[1]:.0%} this season, {w[2]:.0%} all starts"
    if name == "shrink_games":
        return f"a pitcher's own rate fully replaces the league rate after {_fmt(value)} starts; fewer starts stay closer to the league"
    if name == "opp_mult":
        return f"opponent sensitivity multiplier = {_fmt(value)} — {KNOB_PLAIN['opp_mult']}"
    if name == "minutes_window":
        return f"minutes are the average of the last {value} games"
    if name == "recent_cap":
        return (
            f"only the last {value} games are kept. "
            + ("That is the previous cap, so a 15-game window only saw 10 games." if value == 10
               else "The previous formula capped this at 10, so the longest window was shorter than its name.")
        )
    if name == "source" and value == "published":
        return "starts from the previous published projection, then applies the line below"
    table = KNOB_PLAIN.get(name)
    if isinstance(table, dict):
        gloss = table.get(value, "")
        return f"{name} = {value}" + (f" — {gloss}" if gloss else "")
    if isinstance(table, str):
        return f"{name} = {_fmt(value)} — {table}"
    return f"{name} = {_fmt(value)}"


def calibration_sentence(cal) -> str:
    if not cal:
        return "No extra line. The projection above is what gets published."
    return (
        f"Then a straight line is applied: published = {_fmt(cal['a'])} + {_fmt(cal['b'])} × (the projection above). "
        "The line was fit to pull the projection closer to what actually happened, without throwing the shape away."
    )


def resolved_numbers(sport: str, knobs: dict) -> list[str]:
    """Actual weight tuples and window sizes, not just the knob nickname."""
    lines = []
    if sport == "kbo" and "weights" in knobs and knobs["weights"] != "source":
        from ml.kbo.tune import PITCHER_WEIGHTS
        if knobs["weights"] in PITCHER_WEIGHTS:
            w = PITCHER_WEIGHTS[knobs["weights"]]
            lines.append(f"Blend weights (recent, season, all) = {w[0]:.2f}, {w[1]:.2f}, {w[2]:.2f}.")
    if sport == "kbo" and "pa_weights" in knobs:
        from ml.kbo.tune import HRR_PA_W, HRR_RATE_W
        pa, rate = HRR_PA_W[knobs["pa_weights"]], HRR_RATE_W[knobs["rate_weights"]]
        lines.append(f"Plate-appearance weights (last 3, last 6, season) = {pa[0]:.2f}, {pa[1]:.2f}, {pa[2]:.2f}.")
        lines.append(f"Rate weights (last 3, last 6, season) = {rate[0]:.2f}, {rate[1]:.2f}, {rate[2]:.2f}.")
    if sport == "wnba" and "window_weights" in knobs:
        from ml.wnba.tune import WEIGHTS, WINDOWS
        w, n = WEIGHTS[knobs["window_weights"]], WINDOWS[knobs["windows"]]
        lines.append(f"Per-minute weights on the last {n[0]}, {n[1]}, and {n[2]} games = {w[0]:.2f}, {w[1]:.2f}, {w[2]:.2f}.")
        lines.append(f"Minutes = average of the last {knobs['minutes_window']} games. Defense factor = {knobs['dvp']}.")
    if sport == "nfl" and "weights" in knobs:
        from ml.nfl.tune import WEIGHTS, WINDOWS
        w, n = WEIGHTS[knobs["weights"]], WINDOWS[knobs["windows"]]
        lines.append(
            f"Weights on the last {n[0]}, {n[1]}, and {n[2]} games = {w[0]:.2f}, {w[1]:.2f}, {w[2]:.2f}, "
            f"using only the most recent {knobs['recent_cap']} games."
        )
    return lines


def section(sport: str, params: dict) -> dict:
    # A candidate is live only when that sport's switch publishes tuned numbers.
    # Shadow still scores every candidate, including sports left on current.
    candidate = params.get("recommendation") == "candidate"
    live = candidate and file_mode(sport) == "tuned"
    knobs = (params.get("formula") or {}).get("knobs") or {}
    return {
        "sport": sport,
        "stat": params["stat"],
        "candidate": candidate,
        "live": live,
        "file": params.get("_file"),
        "plain": STAT_PLAIN.get((sport, params["stat"]), params["stat"]),
        "knob_lines": [knob_sentence(sport, key, knobs[key]) for key in knobs],
        "numbers": resolved_numbers(sport, knobs),
        "calibration": calibration_sentence(params.get("linear_calibration")),
        "calibration_raw": params.get("linear_calibration"),
        "mae_current": (params.get("walk_forward") or {}).get("mae_current"),
        "mae_tuned": (params.get("walk_forward") or {}).get("mae_tuned"),
    }


def all_sections() -> list[dict]:
    rows = []
    for sport in SPORTS:
        for params in load_params(sport).values():
            rows.append(section(sport, params))
    rows.sort(key=lambda row: (row["sport"], not row["live"], row["stat"]))
    return rows


def mode_label() -> str:
    return ", ".join(f"{sport} **{file_mode(sport)}**" for sport in SPORTS)


REVERT = """## How to roll back

KBO publishes the tuned formulas because `pipeline/projection_formula.json` sets `sports.kbo` to `tuned`. WNBA and NFL stay on the previous formulas (`sports.wnba` and `sports.nfl` are `current`). The top-level `mode` is only the fallback when a sport is not listed.

To put KBO back on the previous formulas:

1. Set `sports.kbo` to `current`. One KBO job can instead set `CG_PROJECTION_FORMULA=current`. That env value overrides every sport for that one run, so do not set it on a WNBA or NFL refresh unless those sports should move too.
2. Rerun **Refresh Data & Deploy to Vercel** (`.github/workflows/deploy.yml`). A push to `main` that touches `pipeline/**` or `generate_*.py` starts it. It runs `pipeline/run_release.sh`, which regenerates pitcher and batter projections and deploys the site.

WNBA and NFL publish the previous formula. Run **Refresh WNBA Data** or **Refresh WNBA PrizePicks Lines (30 min)** and **Refresh NFL PrizePicks Board** once after this change so boards generated while every sport was `tuned` are rewritten. Later, if either sport is set to `tuned`, rerun that same refresh.

Shadow keeps scoring both formulas either way. While a sport is `tuned`, that sport's site number is the tuned fit and `baseline_projection` on each row is the previous formula.
"""


def markdown(rows: list[dict]) -> str:
    lines = [
        "# Live projection formulas",
        "",
        f"Config file: `pipeline/projection_formula.json` ({mode_label()}).",
        "",
        "A sport publishes a tuned formula only when its switch is `tuned` and that stat's file in `ml/params` says `recommendation: candidate`. Those are the fits shadow mode has been comparing with the previous formula. Every other stat, and every sport left on `current`, stays on the previous formula. Shadow still scores the candidates that are not published.",
        "",
        "Numbers below are copied from those params files. They are not re-fit here.",
        "",
        REVERT.strip(),
        "",
    ]
    for sport in SPORTS:
        sport_rows = [row for row in rows if row["sport"] == sport]
        lines.append(f"## {sport.upper()}")
        lines.append("")
        live = [row for row in sport_rows if row["live"]]
        shadow_only = [row for row in sport_rows if row.get("candidate") and not row["live"]]
        held = [row for row in sport_rows if not row.get("candidate")]
        lines.append(
            f"Live on the tuned formula: {len(live)}. "
            f"Shadow candidates published as the previous formula: {len(shadow_only)}. "
            f"Not adopted, previous formula: {len(held)}."
        )
        lines.append("")
        for row in live:
            lines.extend(_md_stat(row))
        if shadow_only:
            lines.append("### Tuned in shadow, previous formula on the site")
            lines.append("")
            lines.append(
                f"{sport.upper()} is `{file_mode(sport)}`, so these candidates are not published. "
                "Shadow still scores them against the previous formula."
            )
            lines.append("")
            for row in shadow_only:
                lines.append(f"- **{row['stat']}** (`{row['file']}`). {row['plain']}")
            lines.append("")
        if held:
            lines.append("### Left on the previous formula")
            lines.append("")
            lines.append("Shadow did not adopt these. The site still uses the formula it used before this switch.")
            lines.append("")
            for row in held:
                lines.append(f"- **{row['stat']}** (`{row['file']}`). {row['plain']}")
            lines.append("")
    return "\n".join(lines).rstrip() + "\n"


def _md_stat(row: dict) -> list[str]:
    out = [f"### {row['stat']}", "", row["plain"], "", f"Source: `{row['file']}`.", ""]
    out.append("What goes in:")
    out.append("")
    for line in row["knob_lines"]:
        out.append(f"- {line}")
    out.append("")
    for line in row["numbers"]:
        out.append(line)
        out.append("")
    out.append(row["calibration"])
    out.append("")
    if row["mae_current"] is not None and row["mae_tuned"] is not None:
        out.append(
            f"Walk-forward average error in the Phase 2 report: {_fmt(row['mae_current'])} on the previous formula, "
            f"{_fmt(row['mae_tuned'])} on this one (lower is closer)."
        )
        out.append("")
    return out


def html_doc(rows: list[dict]) -> str:
    parts = ["""<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>CGPropz live projection formulas</title>
<style>
  body { font-family: Georgia, "Iowan Old Style", serif; color: #1c1915; background: #f7f4ee; margin: 0; }
  main { max-width: 820px; margin: 0 auto; padding: 48px 28px 80px; }
  h1 { font-size: 2rem; letter-spacing: -0.02em; margin-bottom: 0.2em; }
  h2 { font-size: 1.4rem; border-top: 2px solid #1c1915; padding-top: 1.2em; margin-top: 2em; }
  h3 { font-size: 1.1rem; margin-bottom: 0.2em; }
  .badge { display: inline-block; font-family: ui-sans-serif, system-ui, sans-serif; font-size: 0.72rem;
           letter-spacing: 0.06em; text-transform: uppercase; background: #1c1915; color: #f7f4ee;
           padding: 0.15em 0.5em; border-radius: 3px; vertical-align: middle; }
  .held { background: #8a8175; }
  p, li { line-height: 1.45; }
  .card { background: white; border: 1px solid #e2dbd0; border-radius: 8px; padding: 16px 18px; margin: 12px 0 18px; }
  .src { font-family: ui-sans-serif, system-ui, sans-serif; font-size: 0.85rem; color: #5c564e; }
  table { width: 100%; border-collapse: collapse; font-family: ui-sans-serif, system-ui, sans-serif; font-size: 0.92rem; }
  th, td { text-align: left; padding: 6px 8px; border-bottom: 1px solid #e2dbd0; vertical-align: top; }
  .note { background: #fff8e8; border: 1px solid #ead9a4; border-radius: 8px; padding: 12px 16px; }
  @media print {
    body { background: white; }
    main { padding: 0; max-width: none; }
    .card, .note { break-inside: avoid; }
    h2 { break-before: page; }
  }
</style>
</head>
<body>
<main>
<h1>Live projection formulas</h1>
<p class="src">Modes in <code>pipeline/projection_formula.json</code>: <strong>""" + html.escape(mode_label().replace("**", "")) + """</strong>. Coefficients are the committed Phase 2 params, not new fits.</p>
<div class="note">
<p><strong>What is live.</strong> A stat is on the tuned formula only when that sport's switch is <code>tuned</code> and its params file says <code>candidate</code>. That is the fit shadow has been scoring. WNBA and NFL stay on the previous formula. Shadow still scores their candidates.</p>
<p><strong>Roll back KBO.</strong> Set <code>sports.kbo</code> to <code>current</code>, then rerun <strong>Refresh Data &amp; Deploy to Vercel</strong> (<code>deploy.yml</code>). One KBO run can also set <code>CG_PROJECTION_FORMULA=current</code>. That env value overrides every sport for that one run.</p>
</div>
"""]
    for sport in ("kbo", "wnba", "nfl"):
        sport_rows = [row for row in rows if row["sport"] == sport]
        parts.append(f"<h2>{sport.upper()}</h2>")
        for row in sport_rows:
            if row["live"]:
                badge, klass = "live · tuned", "badge"
            elif row.get("candidate"):
                badge, klass = "previous formula · shadow only", "badge held"
            else:
                badge, klass = "previous formula", "badge held"
            parts.append("<article class=\"card\">")
            parts.append(f"<h3>{html.escape(row['stat'])} <span class=\"{klass}\">{badge}</span></h3>")
            parts.append(f"<p>{html.escape(row['plain'])}</p>")
            if row["live"]:
                parts.append("<table><tbody>")
                for line in row["knob_lines"]:
                    parts.append(f"<tr><td>{html.escape(line)}</td></tr>")
                for line in row["numbers"]:
                    parts.append(f"<tr><td>{html.escape(line)}</td></tr>")
                parts.append(f"<tr><td>{html.escape(row['calibration'])}</td></tr>")
                parts.append("</tbody></table>")
                if row["mae_current"] is not None:
                    parts.append(
                        f"<p class=\"src\">Walk-forward average error: {_fmt(row['mae_current'])} previous, "
                        f"{_fmt(row['mae_tuned'])} tuned.</p>"
                    )
            parts.append(f"<p class=\"src\">{html.escape(row['file'] or '')}</p>")
            parts.append("</article>")
    parts.append("</main></body></html>\n")
    return "".join(parts)


def main() -> int:
    rows = all_sections()
    DOCS.mkdir(exist_ok=True)
    (DOCS / "live_formulas.md").write_text(markdown(rows), encoding="utf-8")
    (DOCS / "live_formulas.html").write_text(html_doc(rows), encoding="utf-8")
    live = sum(1 for row in rows if row["live"])
    print(f"Wrote docs/live_formulas.md and docs/live_formulas.html ({live} live stats, {mode_label()}, config {CONFIG_PATH.name})")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

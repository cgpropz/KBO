# Live projection formulas

Config file: `pipeline/projection_formula.json` (kbo **tuned**, wnba **current**, nfl **current**).

A sport publishes a tuned formula only when its switch is `tuned` and that stat's file in `ml/params` says `recommendation: candidate`. Those are the fits shadow mode has been comparing with the previous formula. Every other stat, and every sport left on `current`, stays on the previous formula. Shadow still scores the candidates that are not published.

Numbers below are copied from those params files. They are not re-fit here.

## How to roll back

KBO publishes the tuned formulas because `pipeline/projection_formula.json` sets `sports.kbo` to `tuned`. WNBA and NFL stay on the previous formulas (`sports.wnba` and `sports.nfl` are `current`). The top-level `mode` is only the fallback when a sport is not listed.

To put KBO back on the previous formulas:

1. Set `sports.kbo` to `current`. One KBO job can instead set `CG_PROJECTION_FORMULA=current`. That env value overrides every sport for that one run, so do not set it on a WNBA or NFL refresh unless those sports should move too.
2. Rerun **Refresh Data & Deploy to Vercel** (`.github/workflows/deploy.yml`). A push to `main` that touches `pipeline/**` or `generate_*.py` starts it. It runs `pipeline/run_release.sh`, which regenerates pitcher and batter projections and deploys the site.

WNBA and NFL publish the previous formula. Run **Refresh WNBA Data** or **Refresh WNBA PrizePicks Lines (30 min)** and **Refresh NFL PrizePicks Board** once after this change so boards generated while every sport was `tuned` are rewritten. Later, if either sport is set to `tuned`, rerun that same refresh.

Shadow keeps scoring both formulas either way. While a sport is `tuned`, that sport's site number is the tuned fit and `baseline_projection` on each row is the previous formula.

## KBO

Live on the tuned formula: 5. Shadow candidates published as the previous formula: 0. Not adopted, previous formula: 1.

### Fantasy Score

The published fantasy-score projection, then shifted with a straight line.

Source: `ml/params/kbo/fantasy_score.json`.

What goes in:

- starts from the previous published projection, then applies the line below

Then a straight line is applied: published = 3.6225 + 0.5 × (the projection above). The line was fit to pull the projection closer to what actually happened, without throwing the shape away.

Walk-forward average error in the Phase 2 report: 6.8903 on the previous formula, 6.6594 on this one (lower is closer).

### Hits Allowed

Expected hits allowed by today's starter.

Source: `ml/params/kbo/hits_allowed.json`.

What goes in:

- dedupe = fixed — each start is counted once (the old feed double-counted starts whose innings did not match to 3 decimals)
- form = off — recent-form multiplier is turned off (always 1)
- a pitcher's own rate fully replaces the league rate after 10 starts; fewer starts stay closer to the league
- weights = long_run — 10% recent, 20% this season, 70% all starts
- opponent sensitivity multiplier = 0 — multiplier on how strongly the opponent's offense moves the projection (1 = previous sensitivity, 0 = ignore the opponent, 1.5 = one and a half times as sensitive)

Blend weights (recent, season, all) = 0.10, 0.20, 0.70.

Then a straight line is applied: published = 2.1558 + 0.6238 × (the projection above). The line was fit to pull the projection closer to what actually happened, without throwing the shape away.

Walk-forward average error in the Phase 2 report: 1.9425 on the previous formula, 1.8183 on this one (lower is closer).

### Hits+Runs+RBIs

Expected hits plus runs plus RBI for the batter.

Source: `ml/params/kbo/hits_plus_runs_plus_rbis.json`.

What goes in:

- pa_weights = season_heavy — plate appearances: 20% last 3, 30% last 6, 50% season
- rate_weights = season_heavy — those rates: 10% last 3, 20% last 6, 70% season
- opp = corrected — how many hits+runs+RBI that team's pitchers have allowed, versus the league
- park multiplier is off (treated as 1)
- split multiplier is off (treated as 1)
- pitcher multiplier is off (treated as 1)

Plate-appearance weights (last 3, last 6, season) = 0.20, 0.30, 0.50.

Rate weights (last 3, last 6, season) = 0.10, 0.20, 0.70.

Then a straight line is applied: published = 0.3884 + 0.6561 × (the projection above). The line was fit to pull the projection closer to what actually happened, without throwing the shape away.

Walk-forward average error in the Phase 2 report: 1.7736 on the previous formula, 1.6495 on this one (lower is closer).

### Pitching Outs

Expected outs recorded (innings pitched times 3).

Source: `ml/params/kbo/pitching_outs.json`.

What goes in:

- dedupe = fixed — each start is counted once (the old feed double-counted starts whose innings did not match to 3 decimals)
- form = off — recent-form multiplier is turned off (always 1)
- a pitcher's own rate fully replaces the league rate after 3 starts; fewer starts stay closer to the league
- weights = season_heavy — 20% recent, 20% this season, 60% all starts
- opponent sensitivity multiplier = 1 — multiplier on how strongly the opponent's offense moves the projection (1 = previous sensitivity, 0 = ignore the opponent, 1.5 = one and a half times as sensitive)

Blend weights (recent, season, all) = 0.20, 0.20, 0.60.

Then a straight line is applied: published = 5.1833 + 0.7065 × (the projection above). The line was fit to pull the projection closer to what actually happened, without throwing the shape away.

Walk-forward average error in the Phase 2 report: 3.0156 on the previous formula, 2.612 on this one (lower is closer).

### Strikeouts

Expected strikeouts for today's starter.

Source: `ml/params/kbo/strikeouts.json`.

What goes in:

- dedupe = fixed — each start is counted once (the old feed double-counted starts whose innings did not match to 3 decimals)
- form = off — recent-form multiplier is turned off (always 1)
- a pitcher's own rate fully replaces the league rate after 10 starts; fewer starts stay closer to the league
- weights = long_run — 10% recent, 20% this season, 70% all starts
- opponent sensitivity multiplier = 1.5 — multiplier on how strongly the opponent's offense moves the projection (1 = previous sensitivity, 0 = ignore the opponent, 1.5 = one and a half times as sensitive)

Blend weights (recent, season, all) = 0.10, 0.20, 0.70.

No extra line. The projection above is what gets published.

Walk-forward average error in the Phase 2 report: 1.9005 on the previous formula, 1.7932 on this one (lower is closer).

### Left on the previous formula

Shadow did not adopt these. The site still uses the formula it used before this switch.

- **Total Bases** (`ml/params/kbo/total_bases.json`). Expected total bases. This one was not promoted.

## WNBA

Live on the tuned formula: 0. Shadow candidates published as the previous formula: 7. Not adopted, previous formula: 15.

### Tuned in shadow, previous formula on the site

WNBA is `current`, so these candidates are not published. Shadow still scores them against the previous formula.

- **Assists** (`ml/params/wnba/assists.json`). Expected assists, same shape as points.
- **FG Attempted** (`ml/params/wnba/fg_attempted.json`). Expected field-goal attempts.
- **Fantasy Score** (`ml/params/wnba/fantasy_score.json`). Fantasy score from this stat's own per-minute rates for points, rebounds, assists, steals, blocks, and turnovers. It does not reuse the Points prop's formula.
- **Points** (`ml/params/wnba/points.json`). Expected points from per-minute scoring, projected minutes, and the opponent's defense.
- **Pts+Asts** (`ml/params/wnba/pts_plus_asts.json`). Expected points plus assists.
- **Pts+Rebs** (`ml/params/wnba/pts_plus_rebs.json`). Expected points plus rebounds. Each piece uses this stat's own windows, then the pieces are added.
- **Rebs+Asts** (`ml/params/wnba/rebs_plus_asts.json`). Expected rebounds plus assists.

### Left on the previous formula

Shadow did not adopt these. The site still uses the formula it used before this switch.

- **3-PT Attempted** (`ml/params/wnba/3_pt_attempted.json`). 3-PT Attempted
- **3-PT Made** (`ml/params/wnba/3_pt_made.json`). 3-PT Made
- **Blks+Stls** (`ml/params/wnba/blks_plus_stls.json`). Blks+Stls
- **Blocked Shots** (`ml/params/wnba/blocked_shots.json`). Blocked Shots
- **Defensive Rebounds** (`ml/params/wnba/defensive_rebounds.json`). Defensive Rebounds
- **FG Made** (`ml/params/wnba/fg_made.json`). FG Made
- **Free Throws Attempted** (`ml/params/wnba/free_throws_attempted.json`). Free Throws Attempted
- **Free Throws Made** (`ml/params/wnba/free_throws_made.json`). Free Throws Made
- **Offensive Rebounds** (`ml/params/wnba/offensive_rebounds.json`). Offensive Rebounds
- **Pts+Rebs+Asts** (`ml/params/wnba/pts_plus_rebs_plus_asts.json`). Pts+Rebs+Asts
- **Rebounds** (`ml/params/wnba/rebounds.json`). Rebounds
- **Steals** (`ml/params/wnba/steals.json`). Steals
- **Turnovers** (`ml/params/wnba/turnovers.json`). Turnovers
- **Two Pointers Attempted** (`ml/params/wnba/two_pointers_attempted.json`). Two Pointers Attempted
- **Two Pointers Made** (`ml/params/wnba/two_pointers_made.json`). Two Pointers Made

## NFL

Live on the tuned formula: 0. Shadow candidates published as the previous formula: 7. Not adopted, previous formula: 3.

### Tuned in shadow, previous formula on the site

NFL is `current`, so these candidates are not published. Shadow still scores them against the previous formula.

- **Pass Yards** (`ml/params/nfl/pass_yards.json`). Expected passing yards, recalibrated with a straight line.
- **Pass+Rush Yds** (`ml/params/nfl/pass_plus_rush_yds.json`). Expected passing plus rushing yards, recalibrated with a straight line.
- **Rec Targets** (`ml/params/nfl/rec_targets.json`). Expected targets, recalibrated with a straight line.
- **Receiving Yards** (`ml/params/nfl/receiving_yards.json`). Expected receiving yards from the player's earlier games.
- **Receptions** (`ml/params/nfl/receptions.json`). Expected receptions, recalibrated with a straight line.
- **Rush Yards** (`ml/params/nfl/rush_yards.json`). Expected rushing yards. The window mix stays the same; a straight line recalibrates it.
- **Rush+Rec Yds** (`ml/params/nfl/rush_plus_rec_yds.json`). Expected rushing plus receiving yards, recalibrated with a straight line.

### Left on the previous formula

Shadow did not adopt these. The site still uses the formula it used before this switch.

- **Pass Attempts** (`ml/params/nfl/pass_attempts.json`). Expected pass attempts. Left on the previous formula.
- **Pass Completions** (`ml/params/nfl/pass_completions.json`). Expected completions. Left on the previous formula.
- **Rush Attempts** (`ml/params/nfl/rush_attempts.json`). Expected rush attempts. Left on the previous formula.

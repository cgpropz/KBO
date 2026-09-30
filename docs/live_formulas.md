# Live projection formulas

Config file: `pipeline/projection_formula.json` (mode **tuned**).

The site publishes a tuned formula only when that stat's file in `ml/params` says `recommendation: candidate`. Those are the fits shadow mode has been comparing with the previous formula. Every other stat stays on the previous formula.

Numbers below are copied from those params files. They are not re-fit here.

## How to roll back

The live site is on the tuned formulas because `pipeline/projection_formula.json` says `"mode": "tuned"`.

To put the previous formulas back:

1. Change that file's `mode` from `tuned` to `current` (or run one job with `CG_PROJECTION_FORMULA=current`).
2. Rerun the refresh that publishes each sport:
   - KBO: **Refresh Data & Deploy to Vercel** (`.github/workflows/deploy.yml`). A push to `main` that touches `pipeline/**` or `generate_*.py` starts it. It runs `pipeline/run_release.sh`, which regenerates pitcher and batter projections and deploys the site.
   - WNBA: **Refresh WNBA Data** (`.github/workflows/wnba-refresh.yml`) and **Refresh WNBA PrizePicks Lines (30 min)** (`.github/workflows/wnba-props-refresh.yml`). Both export snapshots and then run `pipeline/apply_live_formula.py`. Supabase updates without a Vercel redeploy. Start either with `workflow_dispatch` if you do not want to wait for the schedule.
   - NFL: **Refresh NFL PrizePicks Board** (`.github/workflows/nfl-refresh.yml`). It runs `python nfl/build_projection_data.py`, which reads the same switch. Start it with `workflow_dispatch` or wait for the next scheduled run.

Shadow keeps scoring both formulas either way. While mode is `tuned`, the site number is the tuned fit and `baseline_projection` on each row is the previous formula.

## KBO

Live on the tuned formula: 5. Still on the previous formula: 1.

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

Live on the tuned formula: 7. Still on the previous formula: 15.

### Assists

Expected assists, same shape as points.

Source: `ml/params/wnba/assists.json`.

What goes in:

- window_weights = long_heavy — 20% shortest, 30% middle, 50% longest
- windows = longest — last 7, 15, and 30 games
- minutes are the average of the last 5 games
- dvp = on — full defense-vs-position factor

Per-minute weights on the last 7, 15, and 30 games = 0.20, 0.30, 0.50.

Minutes = average of the last 5 games. Defense factor = on.

No extra line. The projection above is what gets published.

Walk-forward average error in the Phase 2 report: 1.8218 on the previous formula, 1.6988 on this one (lower is closer).

### FG Attempted

Expected field-goal attempts.

Source: `ml/params/wnba/fg_attempted.json`.

What goes in:

- window_weights = long_heavy — 20% shortest, 30% middle, 50% longest
- windows = longest — last 7, 15, and 30 games
- minutes are the average of the last 10 games
- dvp = off — defense-vs-position factor turned off

Per-minute weights on the last 7, 15, and 30 games = 0.20, 0.30, 0.50.

Minutes = average of the last 10 games. Defense factor = off.

No extra line. The projection above is what gets published.

Walk-forward average error in the Phase 2 report: 3.0462 on the previous formula, 2.8627 on this one (lower is closer).

### Fantasy Score

Fantasy score from this stat's own per-minute rates for points, rebounds, assists, steals, blocks, and turnovers. It does not reuse the Points prop's formula.

Source: `ml/params/wnba/fantasy_score.json`.

What goes in:

- window_weights = long_heavy — 20% shortest, 30% middle, 50% longest
- windows = longest — last 7, 15, and 30 games
- minutes are the average of the last 15 games
- dvp = on — full defense-vs-position factor

Per-minute weights on the last 7, 15, and 30 games = 0.20, 0.30, 0.50.

Minutes = average of the last 15 games. Defense factor = on.

No extra line. The projection above is what gets published.

Walk-forward average error in the Phase 2 report: 8.5295 on the previous formula, 8.1485 on this one (lower is closer).

### Points

Expected points from per-minute scoring, projected minutes, and the opponent's defense.

Source: `ml/params/wnba/points.json`.

What goes in:

- window_weights = balanced — about one third on each window
- windows = longest — last 7, 15, and 30 games
- minutes are the average of the last 15 games
- dvp = half — square root of the defense-vs-position factor (a milder adjustment)

Per-minute weights on the last 7, 15, and 30 games = 0.34, 0.33, 0.33.

Minutes = average of the last 15 games. Defense factor = half.

No extra line. The projection above is what gets published.

Walk-forward average error in the Phase 2 report: 4.7696 on the previous formula, 4.6458 on this one (lower is closer).

### Pts+Asts

Expected points plus assists.

Source: `ml/params/wnba/pts_plus_asts.json`.

What goes in:

- window_weights = long_heavy — 20% shortest, 30% middle, 50% longest
- windows = longer — last 5, 10, and 20 games
- minutes are the average of the last 15 games
- dvp = half — square root of the defense-vs-position factor (a milder adjustment)

Per-minute weights on the last 5, 10, and 20 games = 0.20, 0.30, 0.50.

Minutes = average of the last 15 games. Defense factor = half.

No extra line. The projection above is what gets published.

Walk-forward average error in the Phase 2 report: 5.451 on the previous formula, 5.2854 on this one (lower is closer).

### Pts+Rebs

Expected points plus rebounds. Each piece uses this stat's own windows, then the pieces are added.

Source: `ml/params/wnba/pts_plus_rebs.json`.

What goes in:

- window_weights = long_heavy — 20% shortest, 30% middle, 50% longest
- windows = longer — last 5, 10, and 20 games
- minutes are the average of the last 15 games
- dvp = half — square root of the defense-vs-position factor (a milder adjustment)

Per-minute weights on the last 5, 10, and 20 games = 0.20, 0.30, 0.50.

Minutes = average of the last 15 games. Defense factor = half.

No extra line. The projection above is what gets published.

Walk-forward average error in the Phase 2 report: 5.8159 on the previous formula, 5.6862 on this one (lower is closer).

### Rebs+Asts

Expected rebounds plus assists.

Source: `ml/params/wnba/rebs_plus_asts.json`.

What goes in:

- window_weights = long_heavy — 20% shortest, 30% middle, 50% longest
- windows = longest — last 7, 15, and 30 games
- minutes are the average of the last 15 games
- dvp = half — square root of the defense-vs-position factor (a milder adjustment)

Per-minute weights on the last 7, 15, and 30 games = 0.20, 0.30, 0.50.

Minutes = average of the last 15 games. Defense factor = half.

No extra line. The projection above is what gets published.

Walk-forward average error in the Phase 2 report: 2.9583 on the previous formula, 2.8271 on this one (lower is closer).

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

Live on the tuned formula: 7. Still on the previous formula: 3.

### Pass Yards

Expected passing yards, recalibrated with a straight line.

Source: `ml/params/nfl/pass_yards.json`.

What goes in:

- weights = live — 50% on the shortest window, 25% on the middle, 25% on the longest
- windows = live — means of the last 3, 9, and 15 games
- only the last 10 games are kept. That is the previous cap, so a 15-game window only saw 10 games.

Weights on the last 3, 9, and 15 games = 0.50, 0.25, 0.25, using only the most recent 10 games.

Then a straight line is applied: published = 99.4568 + 0.547 × (the projection above). The line was fit to pull the projection closer to what actually happened, without throwing the shape away.

Walk-forward average error in the Phase 2 report: 68.3331 on the previous formula, 66.9322 on this one (lower is closer).

### Pass+Rush Yds

Expected passing plus rushing yards, recalibrated with a straight line.

Source: `ml/params/nfl/pass_plus_rush_yds.json`.

What goes in:

- weights = live — 50% on the shortest window, 25% on the middle, 25% on the longest
- windows = live — means of the last 3, 9, and 15 games
- only the last 10 games are kept. That is the previous cap, so a 15-game window only saw 10 games.

Weights on the last 3, 9, and 15 games = 0.50, 0.25, 0.25, using only the most recent 10 games.

Then a straight line is applied: published = 109.181 + 0.5424 × (the projection above). The line was fit to pull the projection closer to what actually happened, without throwing the shape away.

Walk-forward average error in the Phase 2 report: 70.889 on the previous formula, 69.3233 on this one (lower is closer).

### Rec Targets

Expected targets, recalibrated with a straight line.

Source: `ml/params/nfl/rec_targets.json`.

What goes in:

- weights = live — 50% on the shortest window, 25% on the middle, 25% on the longest
- windows = live — means of the last 3, 9, and 15 games
- only the last 10 games are kept. That is the previous cap, so a 15-game window only saw 10 games.

Weights on the last 3, 9, and 15 games = 0.50, 0.25, 0.25, using only the most recent 10 games.

Then a straight line is applied: published = 0.3888 + 0.8481 × (the projection above). The line was fit to pull the projection closer to what actually happened, without throwing the shape away.

Walk-forward average error in the Phase 2 report: 2.164 on the previous formula, 2.1219 on this one (lower is closer).

### Receiving Yards

Expected receiving yards from the player's earlier games.

Source: `ml/params/nfl/receiving_yards.json`.

What goes in:

- weights = long_heavy — 25% on the shortest window, 25% on the middle, 50% on the longest
- windows = live — means of the last 3, 9, and 15 games
- only the last 15 games are kept. The previous formula capped this at 10, so the longest window was shorter than its name.

Weights on the last 3, 9, and 15 games = 0.25, 0.25, 0.50, using only the most recent 15 games.

Then a straight line is applied: published = 0.7672 + 0.8528 × (the projection above). The line was fit to pull the projection closer to what actually happened, without throwing the shape away.

Walk-forward average error in the Phase 2 report: 23.7235 on the previous formula, 22.7339 on this one (lower is closer).

### Receptions

Expected receptions, recalibrated with a straight line.

Source: `ml/params/nfl/receptions.json`.

What goes in:

- weights = live — 50% on the shortest window, 25% on the middle, 25% on the longest
- windows = live — means of the last 3, 9, and 15 games
- only the last 10 games are kept. That is the previous cap, so a 15-game window only saw 10 games.

Weights on the last 3, 9, and 15 games = 0.50, 0.25, 0.25, using only the most recent 10 games.

Then a straight line is applied: published = 0.3103 + 0.8215 × (the projection above). The line was fit to pull the projection closer to what actually happened, without throwing the shape away.

Walk-forward average error in the Phase 2 report: 1.681 on the previous formula, 1.6366 on this one (lower is closer).

### Rush Yards

Expected rushing yards. The window mix stays the same; a straight line recalibrates it.

Source: `ml/params/nfl/rush_yards.json`.

What goes in:

- weights = live — 50% on the shortest window, 25% on the middle, 25% on the longest
- windows = live — means of the last 3, 9, and 15 games
- only the last 10 games are kept. That is the previous cap, so a 15-game window only saw 10 games.

Weights on the last 3, 9, and 15 games = 0.50, 0.25, 0.25, using only the most recent 10 games.

Then a straight line is applied: published = 5.858 + 0.7909 × (the projection above). The line was fit to pull the projection closer to what actually happened, without throwing the shape away.

Walk-forward average error in the Phase 2 report: 25.7317 on the previous formula, 24.9146 on this one (lower is closer).

### Rush+Rec Yds

Expected rushing plus receiving yards, recalibrated with a straight line.

Source: `ml/params/nfl/rush_plus_rec_yds.json`.

What goes in:

- weights = live — 50% on the shortest window, 25% on the middle, 25% on the longest
- windows = live — means of the last 3, 9, and 15 games
- only the last 10 games are kept. That is the previous cap, so a 15-game window only saw 10 games.

Weights on the last 3, 9, and 15 games = 0.50, 0.25, 0.25, using only the most recent 10 games.

Then a straight line is applied: published = 3.8716 + 0.8667 × (the projection above). The line was fit to pull the projection closer to what actually happened, without throwing the shape away.

Walk-forward average error in the Phase 2 report: 29.9949 on the previous formula, 29.2547 on this one (lower is closer).

### Left on the previous formula

Shadow did not adopt these. The site still uses the formula it used before this switch.

- **Pass Attempts** (`ml/params/nfl/pass_attempts.json`). Expected pass attempts. Left on the previous formula.
- **Pass Completions** (`ml/params/nfl/pass_completions.json`). Expected completions. Left on the previous formula.
- **Rush Attempts** (`ml/params/nfl/rush_attempts.json`). Expected rush attempts. Left on the previous formula.

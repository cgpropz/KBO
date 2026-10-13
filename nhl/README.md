# NHL

The props board (`python -m nhl.build_board`) is unchanged by the anytime goal scorer preview.

## Anytime goal scorer (admin preview)

`python -m nhl.ags` writes `nhl/ags.json`. The NHL refresh publishes it to the `nhl_ags` table. `/api/data?ds=nhl_ags` returns that row only for the admin email. Members and logged-out visitors get 403. It is not part of the free preview.

The page is an AGS tab on the NHL board, visible to that same admin email. CG Score on this tab is the calibrated probability divided by the league-wide scoring rate from prior games only, times 50. 50 is a league-average scorer. That is separate from the props board, where CG Score is the projection divided by the line, times 50.

The model:

- Even-strength and power-play goals per 60 are shrunk toward the position average when the sample is small.
- Tonight's ice time is the recent blend already used for shots (last five games at 35%, handed off from last season over 12 games), then scaled for the posted line or power-play unit.
- The opponent's goals allowed per 60, and the projected starter's save percentage when one is known, move that total versus the league.
- Expected goals is lambda. A 1.18 scale, fit on the first half of the 2025-26 backtest, stands in for goals outside 5-on-5 and 5-on-4. P(score) = 1 - exp(-1.18 * lambda).
- CG Score = P(score) / league scoring rate * 50. The rate is the share of skater games with a goal strictly before the slate, so tonight cannot move it. Bands are &lt;25, 25-50, 50-75, 75-100, and 100+.
- The page shows the approved backtest hit rate for each band, with the game count beside it, plus a small-sample note and "21+ · Play responsibly".
- Price to beat is the American odds whose implied probability equals P(score). A 25% chance is +300. A 60% chance is -150.
- Rank 1 is the toughest matchup, same direction as defense vs position. Fewer goals allowed, and a higher opposing save percentage, rank higher.
- OUT, IR, LTIR, and scratched players on the line sheet are dropped, plus the manual ids the props board already excludes. PR #131 is still a draft, so this preview does not call that NHL.com scratch feed. When `nhl.availability` is on the branch, the preview uses it too.
- The Odds column is in the page and stays hidden (`SHOW_AGS_ODDS` in `kbo-props-ui/src/nhl/NhlAgs.jsx`). There is no odds feed yet.

NFL anytime touchdown props are not in this repo. The NFL board's Pass TDs chip is a quarterback passing market, and that code says it is not Anytime TDs. There is no admin ATD view.

### Warmup recheck

About 30 minutes before puck drop, run:

```bash
python -m nhl.ags --root /tmp/moneypuck --recheck
```

Or dispatch the **NHL AGS warmup recheck** workflow. It refreshes lineups and rebuilds the preview so a scratch or a power-play change comes off the board. That workflow is `workflow_dispatch` only. It is not on a cron. Scheduling waits on launch approval.

Create `public.nhl_ags` from `sql/nhl_ags.sql` before the first publish. The repo does not apply that SQL.

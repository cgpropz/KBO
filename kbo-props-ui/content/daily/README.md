# Daily free top 3 files

One file per sport and ET slate date: `content/daily/{sport}/{YYYY-MM-DD}.json`
(`sport` is `kbo`, `nhl` or `wnba`). The build turns each file into
`/{sport}-player-props/{YYYY-MM-DD}`. The build never queries the database.

The site has no read path to `qa_pick_ledger` that avoids prod SQL during the
day, so Board QA exports the verified rows into this file (outside 6 AM to
midnight ET for any prod SQL) and commits it. A page is indexable, and listed
in the sitemap, only when `verified` is `true`, `verified_by` is set, and
`props` holds exactly three complete standard-line props. Anything else
renders `noindex,follow` with no picks shown. Add `result` to each prop once
graded; the page then shows a Results table and stays up.

```json
{
  "date": "2026-10-20",
  "verified": true,
  "verified_by": "board-qa",
  "verified_at": "2026-10-20T01:10:00-04:00",
  "snapshot_time": "2026-10-19T23:45:00-04:00",
  "date_modified": "2026-10-20T01:10:00-04:00",
  "slate_game_count": 1,
  "props": [
    {
      "ledger_id": "qa_pick_ledger row id",
      "player": "Player Name",
      "team": "Team",
      "opponent": "Opponent",
      "start_time": "2026-10-20T05:30:00-04:00",
      "venue": "Optional ballpark or arena",
      "stat": "Hits",
      "line": 0.5,
      "line_type": "standard",
      "side": "Over",
      "projection": 1.1,
      "cg_score": 71,
      "l10_hits": 7,
      "l10_n": 10,
      "dvp_note": "Optional one-line matchup note",
      "result": "Hit"
    }
  ]
}
```

`result` is one of `Hit`, `Miss`, `Push`, `DNP`, `Void`. Values are copied
from the ledger as stored; the build does not recompute any score.

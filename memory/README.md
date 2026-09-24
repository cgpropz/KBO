# Props Memory Archive

Date-keyed post-game prop recaps for KBO, WNBA, and NFL.

## Layout

```
memory/<sport>/<mm>/<dd>/<yyyy>/
  slate.json   # frozen live lines (merged during live refresh windows)
  recap.json   # written only when the slate day is fully graded
  meta.json    # status: waiting | partial | complete
```

- **KBO** dates use KST game date
- **WNBA** dates use each prop's `gameDate` (ET calendar)
- **NFL** dates use nflverse / schedule `gameday`

Sports stay in separate trees. Forward-only from ship day; no historical backfill required.

## Status semantics (`meta.json`)

- `waiting` — slate frozen (or empty) but finals/actuals not ready
- `partial` — some props graded, some still missing actuals
- `complete` — every slate prop graded (OVER/UNDER/PUSH/DNP) and `recap.json` written

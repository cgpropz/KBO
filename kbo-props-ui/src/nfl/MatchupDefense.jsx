// "Adj" matchup chip and player-page stat: opponent-adjusted defense vs
// position from nflverse play-by-play, next to the existing DvP grade.
// Context only. It is not part of CG Score or projections.
import { useState } from 'react'
import { MATCHUP_CREDIT_URL, chipAriaLabel, matchupEntries, matchupSummary, matchupTitle, matchupTooltip, smallSampleNote } from './matchupDefenseModel.js'
import './matchupDefenseChip.css'

// Own class names: the global .grade-* classes paint solid backgrounds.
function gradeClass(grade) {
  if (!grade) return 'adj-na'
  return `adj-${grade[0].toLowerCase()}`
}

function Note({ entries, payload }) {
  return (
    <span className="nfl-adj-note" role="note">
      <b className="nfl-adj-note-title">Adj matchup <small>(not DvP · 32 = easiest)</small></b>
      {entries.map((entry) => <span key={entry.split}>{matchupTooltip(entry, payload, { credit: false })}</span>)}
      {smallSampleNote(entries) ? <span className="nfl-adj-note-small">{smallSampleNote(entries)}</span> : null}
      <a href={MATCHUP_CREDIT_URL} target="_blank" rel="noopener noreferrer" onClick={(event) => event.stopPropagation()}>Data: nflverse</a>
    </span>
  )
}

// Compact chip for board rows: "Adj B+" (with "*" / "*RB" on small samples).
// Display only: no tap, hover title or explanation box. The detail lives on
// the player-page ADJ MATCHUP tile; the nflverse credit is in the site footer.
export function AdjMatchupChip({ payload, prop, position, opponent }) {
  const entries = matchupEntries(payload, { prop, position, opponent })
  if (!entries.length) return null
  const summary = matchupSummary(entries)
  return (
    <span className="nfl-adj-wrap">
      <span
        className={`nfl-adj-chip ${gradeClass(summary.grade)}${summary.smallSample ? ' small-sample' : ''}`}
        role="img"
        aria-label={chipAriaLabel(summary)}
      >
        <small aria-hidden="true">Adj</small> <span aria-hidden="true">{summary.grade}</span>{summary.marker ? <sup className="nfl-adj-mark" aria-hidden="true">{summary.marker}</sup> : null}
      </span>
    </span>
  )
}

// Player-page summary stat: "ADJ. MATCHUP ⓘ 12/32 · WR tgts B-". Tap for detail.
export function AdjMatchupStat({ payload, prop, position, opponent }) {
  const [open, setOpen] = useState(false)
  const entries = matchupEntries(payload, { prop, position, opponent })
  if (!entries.length) return null
  const [first] = entries
  const summary = matchupSummary(entries)
  const title = matchupTitle(entries, payload)
  return (
    <div className={`nfl-adj-stat${summary.smallSample ? ' small-sample' : ''}`}>
      <button type="button" className="nfl-adj-stat-btn" title={title} aria-label={title} aria-expanded={open} onClick={() => setOpen((value) => !value)}>
        <small>ADJ MATCHUP <span aria-hidden="true">ⓘ</span></small>
        <strong>{first.rank}<i> /32</i></strong>
        <span className={`nfl-adj-sub ${gradeClass(first.grade)}`}>Adj {first.grade} · {first.shortLabel}{summary.smallSample ? ` · ${first.smallSample ? '' : `${summary.smallSplits.join(', ')} `}small sample*` : ''}</span>
      </button>
      {open && <Note entries={entries} payload={payload} />}
    </div>
  )
}

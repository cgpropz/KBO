// "Adj" matchup chip and player-page stat: opponent-adjusted defense vs
// position from nflverse play-by-play, next to the existing DvP grade.
// Context only. It is not part of CG Score or projections.
import { useState } from 'react'
import { MATCHUP_CREDIT_URL, matchupEntries, matchupTooltip } from './matchupDefenseModel.js'
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
      {entries.map((entry) => <span key={entry.split}>{matchupTooltip(entry, payload)}</span>)}
      <a href={MATCHUP_CREDIT_URL} target="_blank" rel="noopener noreferrer" onClick={(event) => event.stopPropagation()}>Data: nflverse</a>
    </span>
  )
}

// Compact chip for board rows: "Adj B+". Tap or hover for the detail.
export function AdjMatchupChip({ payload, prop, position, opponent }) {
  const [open, setOpen] = useState(false)
  const entries = matchupEntries(payload, { prop, position, opponent })
  if (!entries.length) return null
  const [first] = entries
  const title = entries.map((entry) => matchupTooltip(entry, payload)).join('\n')
  return (
    <span className="nfl-adj-wrap">
      <button
        type="button"
        className={`nfl-adj-chip ${gradeClass(first.grade)}${first.smallSample ? ' small-sample' : ''}`}
        title={title}
        aria-label={title}
        aria-expanded={open}
        onClick={(event) => { event.stopPropagation(); setOpen((value) => !value) }}
        onKeyDown={(event) => event.stopPropagation()}
      >
        <small>Adj</small> {first.grade}
      </button>
      {open && <Note entries={entries} payload={payload} />}
    </span>
  )
}

// Player-page summary stat: "ADJ. MATCHUP ⓘ 12/32 · WR tgts B-". Tap for detail.
export function AdjMatchupStat({ payload, prop, position, opponent }) {
  const [open, setOpen] = useState(false)
  const entries = matchupEntries(payload, { prop, position, opponent })
  if (!entries.length) return null
  const [first] = entries
  const title = entries.map((entry) => matchupTooltip(entry, payload)).join('\n')
  return (
    <div className="nfl-adj-stat">
      <button type="button" className="nfl-adj-stat-btn" title={title} aria-label={title} aria-expanded={open} onClick={() => setOpen((value) => !value)}>
        <small>ADJ MATCHUP <span aria-hidden="true">ⓘ</span></small>
        <strong>{first.rank}<i> /32</i></strong>
        <span className={`nfl-adj-sub ${gradeClass(first.grade)}`}>Adj {first.grade} · {first.shortLabel}{first.smallSample ? ' · small sample' : ''}</span>
      </button>
      {open && <Note entries={entries} payload={payload} />}
    </div>
  )
}

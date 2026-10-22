import { useState } from 'react'
import { adjustedBookLine, lineAdjustNote } from './cgOdds'

// Display-only pieces for PP Odds rows whose book line differs from the
// PrizePicks line (NFL, NHL and NBA pages). None of this changes a price.

function formatLine(value) {
  const number = Number(value)
  if (!Number.isFinite(number)) return '—'
  return Number.isInteger(number) ? String(number) : number.toFixed(1)
}

// "Best Over @2.5" above a price cell on an adjusted row. Phone cards already
// print the column name above the cell, so there only "@2.5" shows.
export function BookLineLabel({ item, side }) {
  const line = adjustedBookLine(item)
  if (line == null) return null
  return (
    <div className="nfl-sharp-at" title={`Book price at the book line ${formatLine(line)}. PrizePicks posts ${formatLine(item.pp_line)}.`}>
      <span className="nfl-sharp-at-word">Best {side === 'under' ? 'Under' : 'Over'} </span>@{formatLine(line)}
    </div>
  )
}

// Books' fair % for the CG side at the book line, shown beside CG %.
export function BookLinePct({ detail, side }) {
  if (!detail) return null
  const probability = side === 'under' ? 1 - detail.bookOver : detail.bookOver
  const word = side === 'under' ? 'Under' : 'Over'
  return (
    <span className="cgo-prob cgo-book-pct" title={`Books' no-vig ${word} at their own line ${formatLine(detail.bookLine)}, before CG moves it to PrizePicks ${formatLine(detail.ppLine)}.`}>
      <strong>{(probability * 100).toFixed(1)}%</strong>
      <small>Books {word} @{formatLine(detail.bookLine)}</small>
    </span>
  )
}

// The "line adj" tag. Hover shows the note; a tap toggles it inline (phones
// have no hover). The tap does not open the row.
export function LineAdjTag({ item, detail, extra = '' }) {
  const [open, setOpen] = useState(false)
  const note = lineAdjustNote(detail) || `Books post ${formatLine(item.matched_line)}, PrizePicks posts ${formatLine(item.pp_line)}.`
  const title = extra ? `${note} ${extra}` : note
  return (
    <>
      <button
        type="button"
        className="cgo-tag adj"
        title={title}
        aria-label={`line adj: ${title}`}
        aria-expanded={open}
        onClick={(event) => { event.stopPropagation(); setOpen((value) => !value) }}
        onKeyDown={(event) => event.stopPropagation()}
      >
        line adj {formatLine(item.matched_line)}→{formatLine(item.pp_line)}
      </button>
      {open && <span className="cgo-adj-note" role="note">{title}</span>}
    </>
  )
}

import './CgOverMarks.css'
import { cgOverChrome } from './cgOverTreatment.js'

// Flags default off, so this renders nothing until Code Green turns one on.
export function CgOverMarks({ score, side, chrome }) {
  const marks = chrome || (score == null ? null : cgOverChrome(score, side))
  if (!marks || (!marks.badge && !marks.dampened)) return null
  return (
    <span className="cg-over-marks">
      {marks.badge ? <em className="cg-score-unproven" title={marks.badge.title}>{marks.badge.label}</em> : null}
      {marks.dampened ? <em className="cg-score-calibrated" title={marks.rawTitle}>{marks.label}</em> : null}
    </span>
  )
}

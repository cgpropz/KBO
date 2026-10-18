import { useId, useState } from 'react'
import './CgScoreExplainer.css'
import { displayScoreText, sideOfScore } from './sideRank'

export function CgScoreNote({ note }) {
  if (!note) return null
  return (
    <div className="cg-score-note">
      <p><strong>CG Score {note.score}{note.sideLabel ? ` ${note.sideLabel}` : ''}.</strong> {note.lead}</p>
      {note.recent && <p>{note.recent}</p>}
      {note.smallSample && <p>Small sample, so give this less weight.</p>}
      {note.capped && <p>Scores on very small lines are adjusted.</p>}
      <p className="cg-score-note-disclaimer">{note.disclaimer}</p>
    </div>
  )
}

export function WhyThisScore({ note, defaultOpen = false, className = '' }) {
  const [open, setOpen] = useState(defaultOpen)
  const noteId = useId()
  if (!note) return null
  if (defaultOpen) return <CgScoreNote note={note} />
  return (
    <div className={className}>
      <button
        type="button"
        className="cg-score-why"
        aria-expanded={open}
        aria-controls={noteId}
        onClick={(event) => {
          event.stopPropagation()
          setOpen((current) => !current)
        }}
      >
        Why this score?
      </button>
      <div id={noteId}>
        {open && <CgScoreNote note={note} />}
      </div>
    </div>
  )
}

// `symmetric` (NFL admin pilot, src/sideRank.js): an under shows its
// same-side strength (100 minus the score) behind an UNDER tag, and an over
// gets an OVER tag. Otherwise scoreText shows, as today.
export function CgScoreCell({ scoreText, note, open, onToggle, score, side, symmetric = false }) {
  const finite = score != null && Number.isFinite(Number(score))
  const pickSide = finite ? (side || sideOfScore(score)) : null
  const sided = symmetric && finite && pickSide
  return (
    <div className="cg-score-cell">
      {sided
        ? (
          <span className={`cg-score-sided ${pickSide === 'UNDER' ? 'under' : 'over'}`} data-side={pickSide}>
            <em className="cg-score-side-tag">{pickSide === 'UNDER' ? 'UNDER' : 'OVER'}</em>
            {displayScoreText(score, pickSide)}
          </span>
        )
        : <span>{scoreText}</span>}
      {note && (
        <button
          type="button"
          className="cg-score-why"
          aria-expanded={open}
          onClick={(event) => {
            event.stopPropagation()
            onToggle()
          }}
        >
          Why this score?
        </button>
      )}
    </div>
  )
}

import { useId, useState } from 'react'
import './CgScoreExplainer.css'

export function CgScoreNote({ note }) {
  if (!note) return null
  return (
    <div className="cg-score-note">
      <p><strong>CG Score {note.score}.</strong> {note.lead}</p>
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

export function CgScoreCell({ scoreText, note, open, onToggle }) {
  return (
    <div className="cg-score-cell">
      <span>{scoreText}</span>
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

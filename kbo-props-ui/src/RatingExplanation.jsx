import { useEffect, useRef, useState } from 'react'
import { explainProp } from './propExplanation.js'
import './RatingExplanation.css'

export function RatingExplanation({ row }) {
  const explanation = explainProp(row)
  const side = String(explanation.side || 'push').toLowerCase()
  return (
    <section className={`rating-why is-${side}`} aria-label={explanation.title}>
      <div className="rating-why-head">
        <span className="rating-why-side">{explanation.side}</span>
        {explanation.rating ? <span className="rating-why-score">{explanation.rating}</span> : null}
        {explanation.headline ? <span className="rating-why-prop">{explanation.headline}</span> : null}
      </div>
      <ul className="rating-why-lines">
        {explanation.lines.map((line) => (
          <li key={line}>{line}</li>
        ))}
      </ul>
    </section>
  )
}

export function RatingWhyButton({ row, label = 'Why this score' }) {
  const [open, setOpen] = useState(false)
  const panelRef = useRef(null)
  useEffect(() => {
    if (!open || !panelRef.current) return
    panelRef.current.scrollIntoView({ block: 'nearest', behavior: 'smooth' })
  }, [open])
  return (
    <div className="rating-why-block" ref={panelRef}>
      <button
        type="button"
        className="rating-why-toggle"
        aria-expanded={open}
        onClick={(event) => {
          event.stopPropagation()
          setOpen((current) => !current)
        }}
      >
        {open ? 'Hide' : label}
      </button>
      {open && <RatingExplanation row={row} />}
    </div>
  )
}

export default RatingExplanation

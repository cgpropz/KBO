import { useEffect, useRef, useState } from 'react'
import { explainProp } from './propExplanation.js'
import './RatingExplanation.css'

export function RatingExplanation({ row }) {
  const explanation = explainProp(row)
  return (
    <section className="rating-why" aria-label={explanation.title}>
      <h4 className="rating-why-title">{explanation.title}</h4>
      {explanation.paragraphs.map((paragraph) => (
        <p key={paragraph} className="rating-why-copy">{paragraph}</p>
      ))}
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

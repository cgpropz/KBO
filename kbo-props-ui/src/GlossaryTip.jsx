import { useEffect, useId, useLayoutEffect, useRef, useState } from 'react'
import './GlossaryTip.css'

// Tap or hover note. The bubble is fixed so a card with overflow:hidden
// does not clip it. `compact` is an info mark; otherwise the label is the control.
export default function GlossaryTip({ label, text, compact = false, align = 'end' }) {
  const [pinned, setPinned] = useState(false)
  const [hover, setHover] = useState(false)
  const open = pinned || hover
  const [box, setBox] = useState(null)
  const id = useId()
  const rootRef = useRef(null)
  const buttonRef = useRef(null)

  useEffect(() => {
    if (!open) return undefined
    const close = (event) => {
      if (!rootRef.current?.contains(event.target)) {
        setPinned(false)
        setHover(false)
      }
    }
    const onKey = (event) => {
      if (event.key === 'Escape') {
        setPinned(false)
        setHover(false)
      }
    }
    document.addEventListener('pointerdown', close)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('pointerdown', close)
      document.removeEventListener('keydown', onKey)
    }
  }, [open])

  useLayoutEffect(() => {
    if (!open) return undefined
    const place = () => {
      const rect = buttonRef.current?.getBoundingClientRect()
      if (!rect) return
      const width = Math.min(240, Math.max(160, window.innerWidth * 0.7))
      const preferred = align === 'start' ? rect.left : rect.right - width
      const left = Math.max(8, Math.min(preferred, window.innerWidth - width - 8))
      setBox({ top: rect.bottom + 6, left, width })
    }
    place()
    // A click can scroll the focused control into view in the same turn.
    // Ignore that scroll so the note stays open.
    let armed = false
    const arm = window.setTimeout(() => { armed = true }, 200)
    const dismiss = () => {
      if (!armed) return
      setPinned(false)
      setHover(false)
    }
    window.addEventListener('scroll', dismiss, true)
    window.addEventListener('resize', dismiss)
    return () => {
      window.clearTimeout(arm)
      window.removeEventListener('scroll', dismiss, true)
      window.removeEventListener('resize', dismiss)
    }
  }, [open, align])

  return (
    <span
      className="glossary-tip"
      ref={rootRef}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
    >
      <button
        ref={buttonRef}
        type="button"
        className={compact ? 'glossary-tip-btn is-compact' : 'glossary-tip-btn'}
        aria-expanded={open}
        aria-controls={id}
        aria-label={compact ? `${label}. ${text}` : undefined}
        onClick={(event) => {
          event.preventDefault()
          event.stopPropagation()
          setPinned((current) => !current)
        }}
      >
        {compact ? <span aria-hidden="true">i</span> : label}
      </button>
      <span
        id={id}
        role="tooltip"
        className="glossary-tip-bubble"
        hidden={!open}
        style={box ? { top: box.top, left: box.left, width: box.width } : undefined}
      >
        {text}
      </span>
    </span>
  )
}

import { useEffect, useRef, useState } from 'react'
import './ShowAllLinesToggle.css'

// Default boards stay playable. Turning the toggle on loads lines=all and
// keeps the playable rows on screen until that snapshot arrives.
export function useShowAllLines(reloadKey, loadAll) {
  const [showAllLines, setShowAllLines] = useState(false)
  const [allPayload, setAllPayload] = useState(null)
  const loadRef = useRef(loadAll)
  loadRef.current = loadAll
  useEffect(() => {
    setAllPayload(null)
  }, [reloadKey])
  useEffect(() => {
    if (!showAllLines) return undefined
    let cancelled = false
    Promise.resolve()
      .then(() => loadRef.current())
      .then((payload) => {
        if (!cancelled) setAllPayload(payload ?? null)
      })
      .catch(() => {
        if (!cancelled) setAllPayload(null)
      })
    return () => { cancelled = true }
  }, [showAllLines, reloadKey])
  return { showAllLines, setShowAllLines, allPayload }
}

export function ShowAllLinesToggle({ pressed, onChange }) {
  return (
    <button
      type="button"
      className="show-all-lines"
      aria-pressed={pressed === true}
      onClick={() => onChange(!pressed)}
    >
      Show all lines
    </button>
  )
}

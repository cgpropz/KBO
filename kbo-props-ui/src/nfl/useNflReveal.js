import { useEffect, useRef, useState } from 'react'

// ?pass=all opens the NFL boards with the quarantined pass props already
// visible, so a preview can show that state without an extra click.
export function passAllFromLocation(search = typeof window === 'undefined' ? '' : window.location.search) {
  return new URLSearchParams(search || '').get('pass') === 'all'
}

// Loads the lines=all / pass=all snapshot only while one of those toggles
// is on. The default board stays on screen until that snapshot arrives.
export function useNflReveal(reloadKey, active, load) {
  const [payload, setPayload] = useState(null)
  const loadRef = useRef(load)
  loadRef.current = load
  useEffect(() => {
    setPayload(null)
  }, [reloadKey])
  useEffect(() => {
    if (!active) return undefined
    let cancelled = false
    Promise.resolve()
      .then(() => loadRef.current())
      .then((next) => {
        if (!cancelled) setPayload(next ?? null)
      })
      .catch(() => {
        if (!cancelled) setPayload(null)
      })
    return () => { cancelled = true }
  }, [active, reloadKey])
  return payload
}

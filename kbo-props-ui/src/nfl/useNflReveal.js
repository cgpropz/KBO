import { useEffect, useState } from 'react'

// ?pass=all opens the NFL boards with the quarantined pass props already
// visible, so a preview can show that state without an extra click.
export function passAllFromLocation(search = typeof window === 'undefined' ? '' : window.location.search) {
  return new URLSearchParams(search || '').get('pass') === 'all'
}

// `load` must be stable (useCallback). The default board stays up until
// this snapshot arrives.
export function useNflReveal(active, load) {
  const [payload, setPayload] = useState(null)
  useEffect(() => {
    if (!active) return undefined
    let cancelled = false
    Promise.resolve()
      .then(() => load())
      .then((next) => {
        if (!cancelled) setPayload(next ?? null)
      })
      .catch(() => {
        if (!cancelled) setPayload(null)
      })
    return () => { cancelled = true }
  }, [active, load])
  return payload
}

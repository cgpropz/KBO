import { useEffect, useState } from 'react'
import { fetchNflMatchupDefense } from './nflData'

// Opponent-adjusted matchup payload (nflverse), or null until loaded / on error.
export function useNflMatchupDefense() {
  const [payload, setPayload] = useState(null)
  useEffect(() => {
    let live = true
    fetchNflMatchupDefense().then((value) => { if (live) setPayload(value) })
    return () => { live = false }
  }, [])
  return payload
}

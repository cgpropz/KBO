import { useState } from 'react'
import { viewOnLoad } from './memberNav'

function searchNow() {
  return typeof window === 'undefined' ? '' : window.location.search
}

function viewFor({ sport, entry, forceHome }) {
  return viewOnLoad({ sport, entry, search: searchNow(), forceHome })
}

// Sport-tab clicks used to remount the whole shell (homeTick in the React
// key), which threw away the loaded board. The tick still returns the shell
// to its home view, without unmounting boards that are already open.
export function useSportView({ sport, entry, forceHome, homeTick = 0, initialView = null }) {
  const [view, setView] = useState(() => initialView || viewFor({ sport, entry, forceHome }))
  const [seenTick, setSeenTick] = useState(homeTick)
  if (seenTick !== homeTick) {
    setSeenTick(homeTick)
    const next = viewFor({ sport, entry, forceHome })
    if (next !== view) setView(next)
  }
  return [view, setView]
}

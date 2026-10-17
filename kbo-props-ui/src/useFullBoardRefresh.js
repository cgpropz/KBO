import { useEffect, useRef, useState } from 'react'
import { watchDataset } from './apiData'
import { previewLockedCount } from './previewLockedCount.js'

export { previewLockedCount }

// When a background retry replaces a paid member's preview, apply the full board.
// Returns [refreshExhausted, clearExhausted]. Exhausted means the retries
// finished without a full board, so the preview needs a Retry button.
export function useFullBoardRefresh(ds, apply) {
  const applyRef = useRef(apply)
  applyRef.current = apply
  const [refreshExhausted, setRefreshExhausted] = useState(false)
  useEffect(() => watchDataset(ds, (snapshot) => {
    if (!snapshot) return
    if (snapshot.refreshExhausted) {
      setRefreshExhausted(true)
      return
    }
    if (snapshot.preview === false) {
      setRefreshExhausted(false)
      applyRef.current(snapshot)
    }
  }), [ds])
  return [refreshExhausted, () => setRefreshExhausted(false)]
}

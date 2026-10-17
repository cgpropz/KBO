import { useEffect, useRef } from 'react'
import { watchDataset } from './apiData'

// When a background retry replaces a paid member's preview, apply the full board.
export function useFullBoardRefresh(ds, apply) {
  const applyRef = useRef(apply)
  applyRef.current = apply
  useEffect(() => watchDataset(ds, (snapshot) => {
    if (snapshot && snapshot.preview === false) applyRef.current(snapshot)
  }), [ds])
}

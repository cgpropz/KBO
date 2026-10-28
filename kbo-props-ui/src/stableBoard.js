import { stampTipLanes, tipKeys } from './tipFirst.js'

// Rank the slate once and stamp tip lanes on those objects. Later filters
// return the same objects, so a click does not clone or rescore the board.
export function rankWithTipLanes(rows, compare, keyOf) {
  const ranked = [...(rows || [])].sort(compare)
  return stampTipLanes(ranked, tipKeys(ranked, keyOf), keyOf)
}

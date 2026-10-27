// Display lanes for the tip-first board. Rank order is whatever list the
// caller already sorted. This module does not score, project, or re-rank.

export const TIP_LIMIT = 3
export const TIP_LABEL = "Today's tip"
export const UNPROVEN_LABEL = 'Unproven'

// First `limit` identifiable rows in an already CG-ranked list.
export function tipKeys(rows, keyOf, limit = TIP_LIMIT) {
  const keys = new Set()
  for (const row of rows || []) {
    if (keys.size >= limit) break
    const key = keyOf(row)
    if (key == null || key === '') continue
    keys.add(key)
  }
  return keys
}

// `keys` is the tip identity from the unfiltered CG order. A prop filter
// cannot promote a later rank into the tip.
export function stampTipLanes(rows, keys, keyOf) {
  const list = Array.isArray(rows) ? rows : []
  return list.map((row) => {
    const key = keyOf(row)
    const tipLane = key != null && key !== '' && keys.has(key) ? 'tip' : 'unproven'
    return { ...row, tipLane }
  })
}

// Landing tables that are already in rank order. `free` is the free top 3
// itself, so every row is the tip. `ranked` marks the first three.
export function laneAt(index, mode) {
  if (mode === 'free') return 'tip'
  if (mode === 'ranked') return index < TIP_LIMIT ? 'tip' : 'unproven'
  return null
}

export function tipRowClass(lane, className = '') {
  const extra = lane === 'tip' ? 'is-tip' : lane === 'unproven' ? 'is-unproven' : ''
  return [className, extra].filter(Boolean).join(' ')
}

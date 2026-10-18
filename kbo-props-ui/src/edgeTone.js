// Edge color for the slip views. Display only. An edge that shows as zero at
// the displayed precision (0.00 / 0.0) is grey, not red: it is no edge.
export function isZeroEdge(value, digits = 2) {
  if (value == null || value === '') return false
  const n = Number(value)
  if (!Number.isFinite(n)) return false
  return Number(n.toFixed(digits)) === 0
}

export function edgeTone(value, digits = 2) {
  if (isZeroEdge(value, digits)) return 'edge-zero'
  return Number(value) > 0 ? 'edge-pos' : 'edge-neg'
}

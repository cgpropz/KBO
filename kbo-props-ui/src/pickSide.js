// Display side for a prop row. Display only: CG Scores and projections are
// not changed. A projection on the line, or a CG Score of exactly 50, is no
// pick: no side, no color, no O/U letter.

export const NEUTRAL_SCORE = 50

export function pickSide(projection, line, score) {
  if (score != null && Number(score) === NEUTRAL_SCORE) return null
  if (projection == null || projection === '' || line == null || line === '') return null
  const p = Number(projection)
  const l = Number(line)
  if (!Number.isFinite(p) || !Number.isFinite(l)) return null
  if (p > l) return 'OVER'
  if (p < l) return 'UNDER'
  return null
}

// Slip / pick side from an edge (projection - line). Exactly 0 is EVEN.
export function edgeSide(edge) {
  if (edge == null || edge === '') return null
  const value = Number(edge)
  if (!Number.isFinite(value)) return null
  if (value > 0) return 'OVER'
  if (value < 0) return 'UNDER'
  return 'EVEN'
}

export function sideClass(side) {
  return side === 'OVER' ? 'over' : side === 'UNDER' ? 'under' : 'neutral'
}

export function sideLetter(side) {
  return side === 'OVER' ? 'O' : side === 'UNDER' ? 'U' : ''
}

// Points overs on the NHL board.
//
// Promote and rank only an over whose projection is at least 0.86. That is
// the free top list, the CG Score order, and the highlight lists. An over
// from 0.69 up to 0.86 stays on the board and is not promoted. An over
// under 0.69 is not shown. Unders and every other prop are unchanged.
// The anytime goal scorer page is a separate admin surface and is not this gate.

export const POINTS_OVER_SHOW = 0.69
export const POINTS_OVER_PROMOTE = 0.86

export function isPointsProp(stat) {
  return String(stat || '').trim().toLowerCase() === 'points'
}

function hundredths(value) {
  const number = Number(value)
  if (!Number.isFinite(number)) return null
  return Math.round(number * 100)
}

// drop | hold | rank
export function pointsOverDisposition(row) {
  const stat = row?.prop ?? row?.stat
  if (!isPointsProp(stat)) return 'rank'
  const projected = hundredths(row?.projection)
  const posted = hundredths(row?.line)
  if (projected == null || posted == null || projected < posted) return 'rank'
  if (projected < hundredths(POINTS_OVER_SHOW)) return 'drop'
  if (projected < hundredths(POINTS_OVER_PROMOTE)) return 'hold'
  return 'rank'
}

// null when the row leaves the board. A held over is copied with
// rankEligible false so CG ranking, free top lists, and highlights skip it.
export function applyPointsOverGate(row) {
  if (!row || typeof row !== 'object') return null
  const disposition = pointsOverDisposition(row)
  if (disposition === 'drop') return null
  if (disposition === 'hold') return { ...row, rankEligible: false }
  return row
}

const PULLED = new Set(['removed', 'suspended', 'held', 'hold', 'onhold'])

function prizepicksPulled(row) {
  if (!row || typeof row !== 'object') return false
  if (row.removed === true) return true
  const compact = String(row.pp_status ?? row.ppStatus ?? '').toLowerCase().replace(/[^a-z]/g, '')
  return PULLED.has(compact)
}

export function prepareBoardRows(rows) {
  return (Array.isArray(rows) ? rows : [])
    .filter((row) => !prizepicksPulled(row))
    .map(applyPointsOverGate)
    .filter(Boolean)
}

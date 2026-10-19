// Points overs on the NHL board.
//
// Promote and rank only an over whose projection is at least 0.78. That is
// the free top list, the CG Score order, and the highlight lists. An over
// from 0.69 up to 0.78 stays on the board and is not promoted. An over
// under 0.69 is not shown. Unders and every other prop are unchanged.
// The anytime goal scorer page is a separate admin surface and is not this gate.

export const POINTS_OVER_SHOW = 0.69
export const POINTS_OVER_PROMOTE = 0.78

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

// pp_status values that mean the line is off the board, compared after
// lowercasing and dropping non-letters ("On Hold" -> "onhold"). `out` is the
// NFL ESPN/manual OUT stamp (#251); `replaced` / `superseded` are a line
// PrizePicks swapped for a new one. A row with one of these is pulled even
// when the removed flag is missing. Keep in sync with HELD_STATUS in
// src/memberHub.js.
export const PULLED_PP_STATUSES = new Set(['removed', 'suspended', 'held', 'hold', 'onhold', 'out', 'replaced', 'superseded'])

export function compactPpStatus(value) {
  return String(value ?? '').toLowerCase().replace(/[^a-z]/g, '')
}

export function isPulledPpStatus(value) {
  return PULLED_PP_STATUSES.has(compactPpStatus(value))
}

export function prizepicksPulled(row) {
  if (!row || typeof row !== 'object') return false
  if (row.removed === true) return true
  return isPulledPpStatus(row.pp_status ?? row.ppStatus)
}

// PrizePicks pulled and removed lines. This is every paid board, not the
// NHL Points gate.
export function dropPulledRows(rows) {
  return (Array.isArray(rows) ? rows : []).filter((row) => !prizepicksPulled(row))
}

// NHL board list only. Pulled lines leave, then the Points-over gate runs.
// Other sports must not use this for a stat that happens to be named Points.
export function prepareBoardRows(rows) {
  return dropPulledRows(rows).map(applyPointsOverGate).filter(Boolean)
}

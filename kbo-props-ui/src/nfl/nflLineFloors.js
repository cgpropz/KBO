import { boundCg, lineMatchesStat } from '../cgScore.js'

// Denominator floors for the NFL CG Score. One floor per stat.
//
// The line and the projection
// shown on the row stay the PrizePicks numbers. A yardage line at or below
// 0.5 is still not a score (that card is an any-yards floor). A stat that is
// not in this map still divides by its own line.
//
// Receiving Yards and Rush Yards use the approved Middle score cap: 15.5 and
// 18.5. Those replace the earlier 10th-percentile floors (both 5.5) for those
// two stats. There is no second cap on top of the percentile. Every other
// stat keeps its 10th-percentile floor from the stored NFL slates in
// memory/nfl through 2026-10-12, rounded to the nearest 0.5. The percentile
// is the linear rank on (n - 1) * 0.10, and each of those already landed on
// a 0.5 boundary.

export const NFL_LINE_FLOORS = {
  'Pass Attempts': 28.5,
  'Pass Completions': 18,
  'Pass TDs': 1,
  'Pass Yards': 186.5,
  'Pass+Rush Yds': 210.5,
  'Rec Targets': 2,
  'Receiving Yards': 15.5,
  'Receptions': 1.5,
  'Rush Attempts': 2.5,
  'Rush Yards': 18.5,
  'Rush+Rec Yds': 30.5,
}

// Uncapped, unheld floored ratio score. Only a tie-break key: two rows that
// both show 100 rank by how far past the cap they were.
export function nflRawScore(projection, line, stat) {
  if (!lineMatchesStat(stat, line)) return null
  const p = Number(projection)
  const l = Number(line)
  if (!Number.isFinite(p) || !(l > 0)) return null
  const floor = NFL_LINE_FLOORS[stat]
  const denom = Number.isFinite(floor) ? Math.max(l, floor) : l
  return (p / denom) * 50
}

// Higher shown score first, then higher raw score. Callers add their own
// final tie-break (board order, name).
export function compareNflScores(aScore, aRaw, bScore, bRaw) {
  const as = Number.isFinite(aScore) ? aScore : -Infinity
  const bs = Number.isFinite(bScore) ? bScore : -Infinity
  if (as !== bs) return bs - as
  const ar = Number.isFinite(aRaw) ? aRaw : -Infinity
  const br = Number.isFinite(bRaw) ? bRaw : -Infinity
  return ar === br ? 0 : br - ar
}

// A free-preview row needs a real projection. Number(null) and Number('') are
// both 0, so a blank projection would otherwise score 0 and could still fill
// a free slot when fewer than 3 players are eligible. Blank, null, non-numeric
// and <= 0 projections are Pending, not a pick.
export function nflHasProjection(projection) {
  if (projection == null) return false
  if (typeof projection === 'string' && projection.trim() === '') return false
  const p = Number(projection)
  return Number.isFinite(p) && p > 0
}

export function nflCgScore(projection, line, stat) {
  if (!lineMatchesStat(stat, line)) return null
  const p = Number(projection)
  const l = Number(line)
  if (!Number.isFinite(p) || !(l > 0)) return null
  const floor = NFL_LINE_FLOORS[stat]
  const denom = Number.isFinite(floor) ? Math.max(l, floor) : l
  const raw = (p / denom) * 50
  // A floor above the line keeps a short line from leading, but it must not
  // turn an over into a sub-50 score. An over the floor would push under 50
  // holds at 50 (neutral); an exact tie is 50. Unders are already below 50.
  // With no floor in play this is the same number as before, bounded 0-100.
  const sided = p > l ? Math.max(raw, 50) : p === l ? 50 : Math.min(raw, 50)
  return boundCg(sided)
}

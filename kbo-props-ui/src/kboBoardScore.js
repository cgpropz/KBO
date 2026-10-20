import { boundCg, cgScore, isNeutralCg, lineMatchesStat } from './cgScore.js'
import { prizepicksPulled } from './nhl/pointsGate.js'

// `cg_projection` is a separate 1-100 confidence score. It is high for a
// strong under, so using it as the CG Score ranks below-line picks at 86-95.
// `avg` is the season mean. It is not a projection.

export function modelProjection(prop) {
  if (!prop || !Object.prototype.hasOwnProperty.call(prop, 'projection')) return null
  const raw = prop.projection
  if (raw == null || raw === '') return null
  const projection = Number(raw)
  return Number.isFinite(projection) ? projection : null
}

export function pregameSide(projection, line) {
  if (projection == null || projection === '' || line == null || line === '') return 'NO LINE'
  const projected = Number(projection)
  const posted = Number(line)
  if (!Number.isFinite(projected) || !Number.isFinite(posted)) return 'NO LINE'
  if (projected > posted) return 'OVER'
  if (projected < posted) return 'UNDER'
  return 'EVEN'
}

export function directionFor(prop) {
  const side = pregameSide(modelProjection(prop), prop?.line)
  if (side === 'OVER') return 'over'
  if (side === 'UNDER') return 'under'
  return 'neutral'
}

// formula_source 'none' means no model ran for this row (no stats matched).
// It gets no CG Score, so it is never ranked or picked for the free top 3.
// formula_applied === false alone is not that: stats kept on the standing
// model (Total Bases) still carry a full projection.
export function hasModelNumber(prop) {
  if (prop?.formula_source === 'none') return false
  return modelProjection(prop) != null
}

// The model number for a KBO row, or null when there is none (null or ''
// projection, or formula_source 'none'). Use this instead of Number(...):
// Number(null) is 0, which would show PROJ 0 / CG 0 / UNDER on a no-data row.
export function kboModelProjection(row) {
  return hasModelNumber(row) ? modelProjection(row) : null
}

export function scoreFor(prop) {
  // A line PrizePicks pulled (removed / pp_status) is never ranked.
  if (prizepicksPulled(prop)) return null
  if (!lineMatchesStat(prop?.stat, prop?.line)) return null
  if (!hasModelNumber(prop)) return null
  const projection = modelProjection(prop)
  if (projection == null) return null
  const score = boundCg(cgScore(projection, prop.line, prop.stat))
  return Number.isFinite(score) ? score : null
}

// KBO page rating (Batter and Strikeout projection pages). Same capped CG as
// the board (scoreFor): (projection / line) * 50, bounded 0-100, 1 decimal.
// rawRating keeps the uncapped value for tie-breaks only; it is never shown.
export function kboRawRating(projection, line, stat) {
  if (projection == null || projection === '' || line == null || line === '') return null
  const p = Number(projection)
  const l = Number(line)
  if (!Number.isFinite(p) || !(l > 0)) return null
  const raw = cgScore(p, l, stat)
  return Number.isFinite(raw) ? raw : null
}

export function capKboRating(value) {
  if (value == null || value === '') return null
  const n = Number(value)
  if (!Number.isFinite(n)) return null
  return Number(boundCg(n).toFixed(1))
}

export function kboRating(projection, line, stat) {
  return capKboRating(kboRawRating(projection, line, stat))
}

// Exactly 50 (projection on the line) is neutral: no side color.
export function isNeutralKboRating(rating, rawRating) {
  if (rawRating != null && Number.isFinite(Number(rawRating))) return isNeutralCg(rawRating)
  return isNeutralCg(rating)
}

export function kboRatingClass(rating, rawRating) {
  if (rating == null) return ''
  if (isNeutralKboRating(rating, rawRating)) return 'rate-neutral'
  return rating >= 75 ? 'rate-high' : rating < 30 ? 'rate-low' : rating >= 50 ? 'rate-mid' : 'rate-cool'
}

// Rating sort with the raw-score tiebreak (ties at 100 keep uncapped order).
export function compareKboRating(a, b, dir = 'desc') {
  const sign = dir === 'asc' ? 1 : -1
  const diff = (Number(a.rating) - Number(b.rating)) * sign
  if (diff) return diff
  const ra = Number.isFinite(Number(a.rawRating)) ? Number(a.rawRating) : Number(a.rating)
  const rb = Number.isFinite(Number(b.rawRating)) ? Number(b.rawRating) : Number(b.rating)
  return (ra - rb) * sign
}

// Player-page header. Same number and side as the board cell. `cg_projection`
// is the old 1-100 confidence score and is not this badge.
export function playerHeaderBadge(prop) {
  const score = scoreFor(prop)
  if (score == null) return null
  const side = directionFor(prop)
  const label = side === 'over' ? 'OVER' : side === 'under' ? 'UNDER' : null
  return {
    scoreText: score.toFixed(1),
    side: label ? side : 'neutral',
    label,
  }
}

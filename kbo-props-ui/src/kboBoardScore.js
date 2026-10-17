import { cgScore, lineMatchesStat } from './cgScore.js'

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

export function scoreFor(prop) {
  if (!lineMatchesStat(prop?.stat, prop?.line)) return null
  const projection = modelProjection(prop)
  if (projection == null) return null
  const score = cgScore(projection, prop.line, prop.stat)
  return Number.isFinite(score) ? score : null
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

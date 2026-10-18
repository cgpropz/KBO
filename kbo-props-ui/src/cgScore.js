// A yardage stat posted at 0.5 is PrizePicks' any-yards floor, not a yardage
// line. Scoring it produces ratios around 1000. Counting stats (receptions,
// attempts, touchdowns) at 0.5 are real lines and still score.

const YARDAGE_STAT = /\byards?\b|\byds?\b/i

export function isYardageStat(stat) {
  return YARDAGE_STAT.test(String(stat || ''))
}

export function lineMatchesStat(stat, line) {
  if (!isYardageStat(stat)) return true
  const value = Number(line)
  return Number.isFinite(value) && value > 0.5
}

// KBO and NFL board scores are bounded 0-100. 50 is projection == line.
// Order inside the range is unchanged; a score past either end pins there.
export const CG_MIN = 0
export const CG_MAX = 100

export function boundCg(score) {
  if (score == null) return score
  const value = Number(score)
  if (!Number.isFinite(value)) return value
  return Math.min(CG_MAX, Math.max(CG_MIN, value))
}

// Exactly 50 is no pick: no side, no color, and never in a top list.
export const NEUTRAL_CG = 50

export function cgSide(score) {
  if (score == null) return null
  const value = Number(score)
  if (!Number.isFinite(value) || value === NEUTRAL_CG) return null
  return value > NEUTRAL_CG ? 'OVER' : 'UNDER'
}

export function isNeutralCg(score) {
  return score != null && Number(score) === NEUTRAL_CG
}

export function cgScore(projection, line, stat) {
  if (!lineMatchesStat(stat, line)) return null
  const p = Number(projection)
  const l = Number(line)
  if (!Number.isFinite(p) || !(l > 0)) return 0
  return (p / l) * 50
}

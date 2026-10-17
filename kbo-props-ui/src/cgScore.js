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

export function cgScore(projection, line, stat) {
  if (!lineMatchesStat(stat, line)) return null
  const p = Number(projection)
  const l = Number(line)
  if (!Number.isFinite(p) || !(l > 0)) return 0
  return (p / l) * 50
}

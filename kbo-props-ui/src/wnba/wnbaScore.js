import { lineMatchesStat } from '../cgScore.js'

// Denominator floors for the WNBA CG Score.
//
// Each value is the 10th percentile of standard PrizePicks lines on the stored
// WNBA slates in memory/wnba (through 2026-10-17), then rounded to the nearest
// 0.5. The percentile is the linear rank on (n - 1) * 0.10, the same rule as
// the NFL floors. A stat that is not in this map still divides by its own line.
//
// 3-PT Made is the exception. Its 10th percentile is 0.5 (6 of 45 standard
// lines), and a floor of 0.5 would leave a goblin three at projection / 0.5.
// That stat uses the 25th percentile, 1.5, which is also the most common
// standard three. Blocked Shots and Offensive Rebounds are 0.5 at both the
// 10th and 25th percentiles, because that is the standard market, so the
// floor does not raise a 0.5 line. The line shown on the row stays the
// PrizePicks number. standardLine is not the denominator.

export const WNBA_LINE_FLOORS = {
  '3-PT Attempted': 3.5,
  '3-PT Made': 1.5,
  Assists: 1.5,
  'Blks+Stls': 1.5,
  'Blocked Shots': 0.5,
  'Defensive Rebounds': 4.5,
  'FG Attempted': 9.5,
  'FG Made': 4.5,
  'Fantasy Score': 15.5,
  'Free Throws Attempted': 3.5,
  'Free Throws Made': 2.5,
  'Minutes Played': 33,
  'Offensive Rebounds': 0.5,
  Points: 4.5,
  'Pts+Asts': 7.5,
  'Pts+Rebs': 9.5,
  'Pts+Rebs+Asts': 10.5,
  Rebounds: 3.5,
  'Rebs+Asts': 5,
  Steals: 1.5,
  Turnovers: 1.5,
  'Two Pointers Attempted': 6,
  'Two Pointers Made': 3.5,
}

export function wnbaCgScore(projection, prop) {
  const stat = prop?.stat ?? prop?.prop
  const line = prop?.line
  if (!lineMatchesStat(stat, line)) return null
  const p = Number(projection)
  const l = Number(line)
  if (!Number.isFinite(p) || !(l > 0)) return 0
  const floor = WNBA_LINE_FLOORS[stat]
  const denom = Number.isFinite(floor) ? Math.max(l, floor) : l
  return (p / denom) * 50
}

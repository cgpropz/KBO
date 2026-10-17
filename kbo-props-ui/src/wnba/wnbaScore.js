import { lineMatchesStat } from '../cgScore.js'

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

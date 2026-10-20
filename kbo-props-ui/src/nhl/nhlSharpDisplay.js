// Display helpers for the NHL PP Odds board. They read fields the sharp-odds
// snapshot already sends. They do not recompute a projection, a CG Score, or
// a stored grade.
//
// Matchup is the DvP letter from dvpRank (same buckets as the NFL board).
// Grade is the snapshot's edge letter. A missing letter falls back to the
// same edge bands the NFL odds row already uses. Nothing here writes a grade.

import { dvpGrade } from '../nfl/matchupGrade.js'
import { finiteNumber, hitRateColor } from '../nfl/ppBoardColors.js'

// Same Flex / Power break-evens as BookOddsStrip BASELINES. Copied here so this
// file stays free of JSX and the node tests can import it. NFL still reads
// BASELINES from BookOddsStrip.
const BREAKEVEN = {
  flex: 119 / 219,
  power: 137 / 237,
}

const GRADE_BANDS = [[4, 'A+'], [2, 'A'], [0.5, 'B'], [0, 'C']]
const GRADE_LADDER = ['A+', 'A', 'B', 'C', 'D']

// A projection this far from the line sits on the hit-rate color anchors
// (30 red, 50 on the line, 70 green). hitRateColor clamps past those anchors.
const PROJECTION_GAP = 0.2

export function gradeClass(grade) {
  if (!grade) return 'grade-na'
  return `grade-${String(grade)[0].toLowerCase()}`
}

export function nhlScoredSide(item) {
  if (item?.recommendation === 'UNDER') return 'under'
  if (item?.recommendation === 'OVER') return 'over'
  return null
}

function gradeFromEdge(edge, linePlus) {
  if (edge == null || !Number.isFinite(Number(edge))) return null
  let band = 'D'
  for (const [threshold, grade] of GRADE_BANDS) {
    if (Number(edge) >= threshold) {
      band = grade
      break
    }
  }
  if (linePlus && band !== 'D') band = GRADE_LADDER[Math.max(GRADE_LADDER.indexOf(band) - 1, 0)]
  return band
}

export function nhlSideEdge(item, side, mode) {
  const stored = finiteNumber(item?.[`pp_edge_${side}_${mode}`])
  if (stored != null) return stored
  const fair = finiteNumber(side === 'under' ? item?.fair_under_pct : item?.fair_over_pct)
  if (fair == null) return null
  const breakeven = BREAKEVEN[mode] ?? BREAKEVEN.flex
  return Math.round((fair / 100 - breakeven) * 1000) / 10
}

export function nhlActiveEdge(item, mode) {
  const side = nhlScoredSide(item)
  if (side) return nhlSideEdge(item, side, mode)
  return finiteNumber(mode === 'power' ? item?.pp_edge_power : (item?.pp_edge_flex ?? item?.pp_edge_pct))
}

// The edge letter on the row. Never the matchup letter, and never a stand-in
// when both the stored letter and the edge are missing.
export function nhlDisplayedGrade(item, mode = 'flex', edge = undefined) {
  const stored = mode === 'power' ? item?.grade_power : (item?.grade_flex || item?.grade)
  if (stored) return stored
  const value = edge === undefined ? nhlActiveEdge(item, mode) : edge
  return gradeFromEdge(value, !!item?.line_plus)
}

// DvP rank only. An edge grade of A+ must not fill this cell.
export function nhlMatchupGrade(item) {
  const rank = Number(item?.dvpRank)
  if (!Number.isFinite(rank) || rank <= 0) return null
  return dvpGrade(rank)
}

// Our projection against the posted line, on the NFL hit-rate scale.
// Above the line moves toward green. Below the line moves toward red.
// On the line is the neutral board color. A missing number stays uncolored.
export function projectionVsLineColor(projection, line) {
  const proj = finiteNumber(projection)
  const posted = finiteNumber(line)
  if (proj == null || posted == null || posted === 0) return null
  const delta = (proj - posted) / Math.abs(posted)
  return hitRateColor(50 + (delta / PROJECTION_GAP) * 20)
}

// Public "biggest line edges" list.
//
// Rank playable standard lines by how far the projection sits from the
// posted number. A row that already carries an edge field (projection minus
// line) uses that number. Otherwise the gap is projection − line. This does
// not read CG Score, pp_edge, or any model formula.
//
// Same gates as the free top 3: standard lines only, a real score, not
// neutral, not started, not held or OUT, not a goal-scorer stat. Demon and
// goblin lines are out, including unders PrizePicks will not take and overs
// on those same lines. At most five rows, and the public copy keeps only
// the fields the free preview already shows.

import { lineMatchesStat } from './cgScore.js'
import { rowStartMs, rowStartPassed } from './etStart.js'
import { isNeutralHubRow, playableRows } from './memberHub.js'
import { nbaHighRisk } from './nba/nbaRisk.js'
import { isStandardBoardLine } from './standardBoard.js'

export const LINE_EDGE_LIMIT = 5

// Fields a logged-out response may carry. Anything else stays off the wire.
export const PUBLIC_LINE_EDGE_KEYS = Object.freeze([
  'player', 'team', 'opponent', 'stat', 'line', 'projection', 'side', 'sport', 'edge', 'start', 'score',
])

const STORED_EDGE_KEYS = ['edge', 'lineEdge', 'line_edge']
const GOAL_SCORER = /goal\s*scorers?/i

function finite(value) {
  if (value == null || value === '') return null
  const n = Number(value)
  return Number.isFinite(n) ? n : null
}

export function lineEdgeLimit(limit = LINE_EDGE_LIMIT) {
  const n = Number(limit)
  if (!Number.isFinite(n)) return LINE_EDGE_LIMIT
  return Math.min(LINE_EDGE_LIMIT, Math.max(1, Math.floor(n)))
}

// Signed projection-minus-line gap. An existing edge field wins so the list
// does not invent a second number beside one the row already stored.
export function storedLineEdge(row) {
  if (!row || typeof row !== 'object') return null
  for (const key of STORED_EDGE_KEYS) {
    if (!Object.hasOwn(row, key)) continue
    const n = finite(row[key])
    if (n != null) return n
  }
  return null
}

export function lineEdgeSigned(row) {
  const stored = storedLineEdge(row)
  if (stored != null) return stored
  const projection = finite(row?.projection)
  const line = finite(row?.line)
  if (projection == null || line == null) return null
  return projection - line
}

export function lineEdgeMagnitude(row) {
  const signed = lineEdgeSigned(row)
  return signed == null ? null : Math.abs(signed)
}

function isGoalScorerStat(stat) {
  return GOAL_SCORER.test(String(stat || ''))
}

function eligibleLineEdge(row, now) {
  if (!row?.player) return false
  const stat = row.stat || row.prop
  if (!stat || isGoalScorerStat(stat)) return false
  if (!isStandardBoardLine(row)) return false
  if (row.rankEligible === false) return false
  if (!Number.isFinite(Number(row.line))) return false
  if (!lineMatchesStat(stat, row.line)) return false
  const score = Number(row.score)
  if (!Number.isFinite(score) || score === -Infinity) return false
  if (isNeutralHubRow(row)) return false
  if (rowStartPassed(row, now)) return false
  // Hub rows carry riskPlayer. A public copy already passed this screen and
  // no longer has the field, so a missing riskPlayer is not screened again.
  if (row.sport === 'nba' && row.riskPlayer && nbaHighRisk(row.riskPlayer)) return false
  const magnitude = lineEdgeMagnitude(row)
  return magnitude != null && magnitude > 0
}

export function biggestLineEdges(rows, { limit = LINE_EDGE_LIMIT, now = Date.now(), unavailableNames, starters } = {}) {
  const cap = lineEdgeLimit(limit)
  const playable = playableRows(Array.isArray(rows) ? rows : [], unavailableNames, starters)
  return playable
    .map((row, index) => ({ row, index, magnitude: lineEdgeMagnitude(row) }))
    .filter(({ row }) => eligibleLineEdge(row, now))
    .sort((a, b) => (b.magnitude - a.magnitude) || (a.index - b.index))
    .slice(0, cap)
    .map(({ row }) => row)
}

function sideOf(row, signed) {
  if (row?.side === 'OVER' || row?.side === 'UNDER') return row.side
  if (signed > 0) return 'OVER'
  if (signed < 0) return 'UNDER'
  return ''
}

// Logged-out shape. Drops logs, prices, sharp-edge fields, and risk inputs.
export function publicLineEdgeRow(row) {
  const signed = lineEdgeSigned(row)
  const startMs = rowStartMs(row)
  const out = {
    player: String(row?.player || ''),
    team: row?.team == null ? '' : String(row.team),
    opponent: row?.opponent == null ? '' : String(row.opponent),
    stat: String(row?.stat || row?.prop || ''),
    line: Number(row?.line),
    projection: Number(row?.projection),
    side: sideOf(row, signed),
    sport: row?.sport == null ? '' : String(row.sport),
    edge: signed,
    score: Number(row?.score),
  }
  if (startMs != null) out.start = new Date(startMs).toISOString()
  return out
}

// What the homepage renders for one sport.
// A free preview that did not send lineEdges contributes nothing: the CG
// top 3 is a different list and must not be relabeled as the biggest gaps.
export function landingLineEdges(state, options = {}) {
  if (!state || state.status === 'error') return []
  const source = state.preview === true
    ? (Array.isArray(state.lineEdges) ? state.lineEdges : null)
    : (Array.isArray(state.rows) ? state.rows : [])
  if (source == null) return []
  return biggestLineEdges(source, options).map(publicLineEdgeRow)
}

export function formatLineGap(value) {
  const n = Number(value)
  if (!Number.isFinite(n)) return '—'
  const abs = Math.abs(n)
  const text = Number.isInteger(abs) ? String(abs) : abs.toFixed(1)
  if (n > 0) return `+${text}`
  if (n < 0) return `−${text}`
  return '0'
}

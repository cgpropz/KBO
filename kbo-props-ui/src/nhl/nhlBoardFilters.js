// Filter math for the NHL prop-lines board and the card board.
// Same side, hit-rate, games, position, CG Score, line, and grade fields the
// NFL and NBA drawers use, plus the team and matchup picks on their edge boards.
// Scores stay on cgScore. This does not add a prop the board does not already post.

import { cgScore } from '../cgScore.js'
import { pickSide } from '../pickSide.js'
import { dvpGrade } from '../nfl/matchupGrade.js'

export const NHL_PROP_TABS = ['All Props', 'Shots On Goal', 'Goalie Saves', 'Points', 'Power Play Points']
export const NHL_SORT_OPTIONS = ['CG Score', 'Hit Rate', 'Season', 'H2H', 'DVP']
export const HIT_RATE_OPTIONS = [0, 50, 70, 90, 100]
export const GAMES_OPTIONS = [0, 3, 5, 8, 10]
export const POSITIONS = ['All', 'F', 'D', 'G']
export const GRADE_OPTIONS = ['All Grades', 'A', 'B', 'C', 'D', 'F']
export const DEFAULT_NHL_FILTERS = {
  side: 'All',
  sortBy: 'CG Score',
  minHitRate: 0,
  minGames: 0,
  position: 'All',
  team: 'All',
  matchup: 'All',
  grade: 'All Grades',
  edgeMin: '',
  edgeMax: '',
  lineMin: '',
  lineMax: '',
}

const ALL_PROPS = new Set(['', 'All', 'ALL', 'All Props', 'All props'])

export function nhlDisplayedScore(item) {
  return cgScore(item?.projection, item?.line, item?.prop ?? item?.stat)
}

export function nhlMatchupLabel(item) {
  const team = String(item?.team || '').trim().toUpperCase()
  const opp = String(item?.opponent || '').trim().toUpperCase()
  if (!team || !opp) return ''
  if (item.home === true) return `${opp} @ ${team}`
  if (item.home === false) return `${team} @ ${opp}`
  const [left, right] = [team, opp].sort()
  return `${left} vs ${right}`
}

export function nhlTeamOptions(rows) {
  const teams = new Set()
  for (const row of rows || []) {
    const team = String(row?.team || '').trim().toUpperCase()
    if (team) teams.add(team)
  }
  return ['All', ...[...teams].sort()]
}

export function nhlMatchupOptions(rows) {
  const labels = new Set()
  for (const row of rows || []) {
    const label = nhlMatchupLabel(row)
    if (label) labels.add(label)
  }
  return ['All', ...[...labels].sort()]
}

export function nhlLineBounds(rows) {
  const lines = (rows || []).map((row) => Number(row?.line)).filter((value) => Number.isFinite(value))
  if (!lines.length) return { min: 0, max: 0 }
  return {
    min: Math.floor(Math.min(...lines) * 10) / 10,
    max: Math.ceil(Math.max(...lines) * 10) / 10,
  }
}

export function nhlFiltersNarrowed(filters) {
  const current = filters || DEFAULT_NHL_FILTERS
  return current.side !== DEFAULT_NHL_FILTERS.side
    || current.minHitRate !== DEFAULT_NHL_FILTERS.minHitRate
    || current.minGames !== DEFAULT_NHL_FILTERS.minGames
    || current.position !== DEFAULT_NHL_FILTERS.position
    || current.team !== DEFAULT_NHL_FILTERS.team
    || current.matchup !== DEFAULT_NHL_FILTERS.matchup
    || current.grade !== DEFAULT_NHL_FILTERS.grade
    || current.edgeMin !== ''
    || current.edgeMax !== ''
    || current.lineMin !== ''
    || current.lineMax !== ''
}

function bound(value, fallback) {
  if (value === '' || value == null) return fallback
  const number = Number(value)
  return Number.isFinite(number) ? number : fallback
}

function orderedRange(minText, maxText) {
  let low = bound(minText, -Infinity)
  let high = bound(maxText, Infinity)
  if (low > high) {
    const swap = low
    low = high
    high = swap
  }
  return [low, high]
}

function propMatches(item, propTab) {
  if (ALL_PROPS.has(String(propTab || ''))) return true
  return item?.prop === propTab
}

export function filterNhlRows(rows, { propTab = 'All Props', filters = DEFAULT_NHL_FILTERS, query = '' } = {}) {
  const list = Array.isArray(rows) ? rows : []
  const current = { ...DEFAULT_NHL_FILTERS, ...(filters || {}) }
  const minHit = Number(current.minHitRate) || 0
  const minGames = Number(current.minGames) || 0
  const position = String(current.position || 'All').toUpperCase()
  const team = String(current.team || 'All').trim().toUpperCase()
  const matchup = current.matchup || 'All'
  const grade = current.grade || 'All Grades'
  const [scoreMin, scoreMax] = orderedRange(current.edgeMin, current.edgeMax)
  const [lineMin, lineMax] = orderedRange(current.lineMin, current.lineMax)
  const scoreBounded = scoreMin !== -Infinity || scoreMax !== Infinity
  const lineBounded = lineMin !== -Infinity || lineMax !== Infinity
  const needle = String(query || '').trim().toLowerCase()

  return list.filter((item) => {
    if (!propMatches(item, propTab)) return false
    if (needle) {
      const player = String(item?.player || '').toLowerCase()
      const teamName = String(item?.team || '').toLowerCase()
      if (!player.includes(needle) && !teamName.includes(needle)) return false
    }
    const score = nhlDisplayedScore(item)
    const side = pickSide(item?.projection, item?.line, score)
    if (current.side === 'Overs' && side !== 'OVER') return false
    if (current.side === 'Unders' && side !== 'UNDER') return false
    const hitRate = Number(item?.hitRate ?? 0)
    if ((Number.isFinite(hitRate) ? hitRate : 0) < minHit) return false
    const games = Number(item?.gamesL10 ?? 0)
    if ((Number.isFinite(games) ? games : 0) < minGames) return false
    if (position !== 'ALL' && String(item?.position || '').trim().toUpperCase() !== position) return false
    if (team !== 'ALL' && String(item?.team || '').trim().toUpperCase() !== team) return false
    if (matchup !== 'All' && nhlMatchupLabel(item) !== matchup) return false
    if (grade !== 'All Grades') {
      const letter = dvpGrade(item?.dvpRank)?.[0]
      if (letter !== grade) return false
    }
    if (scoreBounded) {
      const value = Number(score)
      if (!Number.isFinite(value) || value < scoreMin || value > scoreMax) return false
    }
    const line = Number(item?.line)
    if (lineBounded) {
      if (!Number.isFinite(line) || line < lineMin || line > lineMax) return false
    }
    return true
  })
}

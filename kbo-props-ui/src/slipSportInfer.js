import {
  BASKET_PROPS,
  FANTASY_PROPS,
  GRADED_SPORTS,
  KBO_PROPS,
  KBO_TEAMS,
  KNOWN_SPORTS,
  NBA_TEAMS,
  NFL_PROPS,
  NFL_TEAMS,
  NHL_PROPS,
  NHL_TEAMS,
  WNBA_TEAMS,
} from './slipSportCatalog.js'

export { GRADED_SPORTS, KNOWN_SPORTS }

const KBO = setOf(KBO_PROPS)
const FANTASY = setOf(FANTASY_PROPS)
const BASKET = setOf(BASKET_PROPS)
const NFL = setOf(NFL_PROPS)
const NHL = setOf(NHL_PROPS)
const KBO_TEAM = new Set(KBO_TEAMS.map((team) => team.toLowerCase()))
const NFL_TEAM = upperSet(NFL_TEAMS)
const NHL_TEAM = upperSet(NHL_TEAMS)
const WNBA_TEAM = upperSet(WNBA_TEAMS)
const NBA_TEAM = upperSet(NBA_TEAMS)

function setOf(names) {
  return new Set(names.map((name) => name.toLowerCase()))
}

function upperSet(names) {
  return new Set(names.map((name) => name.toUpperCase()))
}

export function normalizeSport(value) {
  const text = String(value ?? '').trim().toLowerCase()
  return KNOWN_SPORTS.includes(text) ? text : ''
}

function classifyProp(name) {
  const key = String(name ?? '').trim().toLowerCase()
  if (!key) return ''
  if (FANTASY.has(key)) return 'fantasy'
  if (key === 'points' || key === 'pts') return 'points'
  if (key === 'pa' || key === 'ra') return 'short'
  if (KBO.has(key)) return 'kbo'
  if (NFL.has(key)) return 'nfl'
  if (NHL.has(key)) return 'nhl'
  if (BASKET.has(key)) return 'basket'
  return ''
}

function teamCode(value) {
  return String(value ?? '').trim().toUpperCase()
}

function isKboTeam(value) {
  return KBO_TEAM.has(String(value ?? '').trim().toLowerCase())
}

function basketLeague(team) {
  const code = teamCode(team)
  if (!code) return ''
  const wnba = WNBA_TEAM.has(code)
  const nba = NBA_TEAM.has(code)
  if (wnba && !nba) return 'wnba'
  if (nba && !wnba) return 'nba'
  return ''
}

function resolveFamily(family, team) {
  if (family === 'kbo' || family === 'nfl' || family === 'nhl') return family
  if (family === 'basket') return basketLeague(team)
  if (family === 'fantasy') {
    if (isKboTeam(team)) return 'kbo'
    return basketLeague(team)
  }
  if (family === 'points') {
    const code = teamCode(team)
    const hockey = NHL_TEAM.has(code)
    const basket = basketLeague(team)
    if (hockey && !basket) return 'nhl'
    if (basket && !hockey) return basket
    return ''
  }
  if (family === 'short') {
    const code = teamCode(team)
    const football = NFL_TEAM.has(code)
    const basket = basketLeague(team)
    if (football && !basket) return 'nfl'
    if (basket && !football) return basket
    return ''
  }
  if (isKboTeam(team)) return 'kbo'
  return ''
}

export function inferLegSport(leg) {
  const explicit = normalizeSport(leg?.sport)
  if (explicit) return explicit
  const fromProp = classifyProp(leg?.prop)
  const family = fromProp || classifyProp(leg?.propShort || leg?.prop_short)
  return resolveFamily(family, leg?.team || '')
}

export function inferSlipSport(slip) {
  const explicit = normalizeSport(slip?.sport)
  if (explicit) return explicit
  const votes = new Map()
  const legs = Array.isArray(slip?.legs) ? slip.legs : []
  for (const leg of legs) {
    const sport = inferLegSport(leg)
    if (!sport) continue
    votes.set(sport, (votes.get(sport) || 0) + 1)
  }
  let winner = ''
  let best = 0
  let tied = false
  for (const [sport, count] of votes) {
    if (count > best) {
      winner = sport
      best = count
      tied = false
    } else if (count === best) {
      tied = true
    }
  }
  return tied ? '' : winner
}

// Null means the slip still shows its hit, miss, push, partial, or pending state.
// "Grading coming soon" is only for a sport with no grader, or a slip the grader
// cannot settle. KBO, NFL, WNBA, and NHL stay pending until their games are final.
export function slipGradeLabel(slip) {
  if (!slip || typeof slip !== 'object') return 'Grading coming soon'
  if (slip.graded === true && slip.result && slip.result !== 'pending') return null
  const sport = inferSlipSport(slip)
  if (!sport || !GRADED_SPORTS.includes(sport)) return 'Grading coming soon'
  const legs = Array.isArray(slip.legs) ? slip.legs : []
  const pending = legs.some((leg) => (leg?.result || 'pending') === 'pending' && !leg?.ungradeable)
  const blocked = legs.some((leg) => leg?.ungradeable || leg?.result === 'ungradeable')
  if (blocked && !pending) return 'Grading coming soon'
  return null
}

// Row math for the NBA prop-lines board. Adapted from the WNBA Dashboard
// (src/wnba/Dashboard.jsx): same score, hit-rate, and grade rules, with NBA's
// five positions and a 30-team defense rank.

import { windowPills } from '../hitRateStrip.js'
import { boundCg, cgScore } from '../cgScore.js'
import { pickSide } from '../pickSide.js'
import { explicitBoardOddsType } from '../standardBoard.js'
import { expectedMinutesPill } from './expectedMinutes.js'
import { gameChartBars } from '../chartLabels.js'
import { newestSeasonLogs } from './nbaGameFilters.js'
import { seasonShortLabel } from './nbaTodayPick.js'

export const EXCLUDED_PROP_LABELS = new Set(['Points - 1st 3 Minutes'])
export const NBA_TEAM_COUNT = 30
export const PROP_TABS = ['All Props', 'Points', 'Rebounds', 'Assists', '3-PT Made', 'Steals', 'Blocks', 'Turnovers', 'Fantasy Score', 'Pts+Rebs+Asts']
export const SEASON_LABEL = String(new Date().getFullYear())
export const MINUTES_SORT = 'Minutes high to low'
export const MINUTES_OPTIONS = ['All', '30+', '20+', 'Under 20']
export const SORT_OPTIONS = ['L10 Hit Rate', 'CG Score', MINUTES_SORT, `${SEASON_LABEL} Hit Rate`, 'H2H Hit Rate', 'DVP Rank']
export const HIT_RATE_OPTIONS = [0, 50, 70, 90, 100]
export const GAMES_OPTIONS = [0, 3, 5, 8, 10]
export const POSITIONS = ['All', 'PG', 'SG', 'SF', 'PF', 'C']
export const GRADE_OPTIONS = ['All Grades', 'A', 'B', 'C', 'D', 'F']
export const DEFAULT_FILTERS = {
  side: 'All',
  sortBy: 'CG Score',
  minutes: 'All',
  minHitRate: 0,
  minGames: 0,
  position: 'All',
  grade: 'All Grades',
  edgeMin: '',
  edgeMax: '',
  lineMin: '',
  lineMax: '',
}

// Counting stats on the roster game log. Field goals, free throws, and
// offensive/defensive rebounds are copied from the same box score that builds
// the hit rate. Older roster files omit them; those props chart from l10Values
// saved next to the hit rate.
const LOG_FIELDS = {
  Points: ['pts'],
  Rebounds: ['reb'],
  Assists: ['ast'],
  '3-PT Made': ['fg3m'],
  Steals: ['stl'],
  Blocks: ['blk'],
  'Blocked Shots': ['blk'],
  Turnovers: ['tov'],
  'Fantasy Score': ['pts', 'reb', 'ast', 'stl', 'blk', 'tov'],
  'Reb+Asts': ['reb', 'ast'],
  'Rebs+Asts': ['reb', 'ast'],
  'Pts+Rebs': ['pts', 'reb'],
  'Pts+Asts': ['pts', 'ast'],
  'Pts+Rebs+Asts': ['pts', 'reb', 'ast'],
  'Blks+Stls': ['blk', 'stl'],
  'Double-Double': ['pts', 'reb', 'ast', 'stl', 'blk'],
  'Triple-Double': ['pts', 'reb', 'ast', 'stl', 'blk'],
}

const OPTIONAL_FIELDS = {
  'Offensive Rebounds': 'oreb',
  'Defensive Rebounds': 'dreb',
  'FG Made': 'fgm',
  'FG Attempted': 'fga',
  'Two Pointers Made': 'fg2m',
  'Two Pointers Attempted': 'fg2a',
  '3-PT Attempted': 'fg3a',
  'Free Throws Made': 'ftm',
  'Free Throws Attempted': 'fta',
}

const ESPN_NBA = {
  ATL: 'atl', BOS: 'bos', BKN: 'bkn', BRK: 'bkn', CHA: 'cha', CHO: 'cha',
  CHI: 'chi', CLE: 'cle', DAL: 'dal', DEN: 'den', DET: 'det',
  GS: 'gs', GSW: 'gs', HOU: 'hou', IND: 'ind', LAC: 'lac', LAL: 'lal',
  MEM: 'mem', MIA: 'mia', MIL: 'mil', MIN: 'min', NO: 'no', NOP: 'no',
  NY: 'ny', NYK: 'ny', OKC: 'okc', ORL: 'orl', PHI: 'phi', PHX: 'phx', PHO: 'phx',
  POR: 'por', SAC: 'sac', SA: 'sa', SAS: 'sa', TOR: 'tor', UTAH: 'utah', UTA: 'utah',
  WSH: 'wsh', WAS: 'wsh',
}

export function nbaLogoUrl(team) {
  const slug = ESPN_NBA[String(team || '').trim().toUpperCase()]
  return slug ? `https://a.espncdn.com/i/teamlogos/nba/500/${slug}.png` : null
}

export function opponentFromMatchup(matchup) {
  const text = String(matchup || '').replace(/vs\./gi, '@').replace(/vs/gi, '@')
  const parts = text.split('@')
  return (parts[parts.length - 1] || '').trim().toUpperCase()
}

function num(value) {
  if (value == null || value === '') return null
  const n = Number(value)
  return Number.isFinite(n) ? n : null
}

function fieldPresent(games, field) {
  return (games || []).some((game) => game && game[field] != null && game[field] !== '')
}

function fantasyScore(game) {
  if (game?.fantasy != null && game.fantasy !== '') return Number(game.fantasy) || 0
  return (Number(game?.pts) || 0)
    + (Number(game?.reb) || 0) * 1.2
    + (Number(game?.ast) || 0) * 1.5
    + (Number(game?.stl) || 0) * 3
    + (Number(game?.blk) || 0) * 3
    - (Number(game?.tov) || 0)
}

function doubleDouble(game) {
  const cats = [game?.pts, game?.reb, game?.ast, game?.stl, game?.blk].map((value) => Number(value) || 0)
  return cats.filter((value) => value >= 10).length >= 2 ? 1 : 0
}

function tripleDouble(game) {
  const cats = [game?.pts, game?.reb, game?.ast, game?.stl, game?.blk].map((value) => Number(value) || 0)
  return cats.filter((value) => value >= 10).length >= 3 ? 1 : 0
}

export function logsSupport(games, label) {
  if (!games?.length) return false
  if (Object.prototype.hasOwnProperty.call(LOG_FIELDS, label)) {
    return LOG_FIELDS[label].every((field) => fieldPresent(games, field))
  }
  const optional = OPTIONAL_FIELDS[label]
  return optional ? fieldPresent(games, optional) : false
}

export function statValue(game, label) {
  if (label === 'Fantasy Score') return fantasyScore(game)
  if (label === 'Double-Double') return doubleDouble(game)
  if (label === 'Triple-Double') return tripleDouble(game)
  if (label === 'Reb+Asts' || label === 'Rebs+Asts') return (Number(game?.reb) || 0) + (Number(game?.ast) || 0)
  if (label === 'Pts+Rebs') return (Number(game?.pts) || 0) + (Number(game?.reb) || 0)
  if (label === 'Pts+Asts') return (Number(game?.pts) || 0) + (Number(game?.ast) || 0)
  if (label === 'Pts+Rebs+Asts') return (Number(game?.pts) || 0) + (Number(game?.reb) || 0) + (Number(game?.ast) || 0)
  if (label === 'Blks+Stls') return (Number(game?.blk) || 0) + (Number(game?.stl) || 0)
  if (label === 'Blocks' || label === 'Blocked Shots') return Number(game?.blk) || 0
  const direct = {
    Points: 'pts',
    Rebounds: 'reb',
    Assists: 'ast',
    '3-PT Made': 'fg3m',
    Steals: 'stl',
    Turnovers: 'tov',
    ...OPTIONAL_FIELDS,
  }[label]
  if (!direct) return null
  return Number(game?.[direct]) || 0
}

export function computeRate(games, label, line) {
  const numericLine = num(line)
  if (!games?.length || numericLine == null || !logsSupport(games, label)) return null
  let hits = 0
  let counted = 0
  games.forEach((game) => {
    const value = statValue(game, label)
    if (value == null || value === numericLine) return
    counted += 1
    if (value > numericLine) hits += 1
  })
  if (!counted) return null
  return { hits, total: counted, pct: (hits / counted) * 100 }
}

function rateFromSeries(values, line) {
  const numericLine = num(line)
  if (!values?.length || numericLine == null) return null
  const decided = values.filter((value) => value !== numericLine)
  if (!decided.length) return null
  const hits = decided.filter((value) => value > numericLine).length
  return { hits, total: decided.length, pct: (hits / decided.length) * 100 }
}

// Newest-first series saved with the hit rate. Empty when the snapshot is
// from before that series was stored, or the stat is not in the box score.
export function storedL10Values(prop) {
  const values = prop?.l10Values
  if (!Array.isArray(values) || !values.length) return null
  const numeric = values.map((value) => Number(value))
  if (numeric.some((value) => !Number.isFinite(value))) return null
  return numeric
}

export function computeH2H(games, label, line, opponent) {
  const target = String(opponent || '').trim().toUpperCase()
  if (!target) return null
  const matched = (games || []).filter((game) => opponentFromMatchup(game?.matchup) === target)
  return computeRate(matched, label, line)
}

function pillFromRate(id, label, result, count = null) {
  if (!result?.total) return null
  return { id, label, rate: Math.round(result.pct), games: result.total, count }
}

function fixedLogPill(games, label, line, size, id, pillLabel) {
  const slice = (games || []).slice(0, size)
  if (slice.length < size) return null
  return pillFromRate(id, pillLabel, computeRate(slice, label, line))
}

// Board logs are trimmed to ten games (api/_boardPayload.js).
export const BOARD_LOG_LIMIT = 10

// This season only, labelled like the profile ('26-27), with its true game
// count (#383). Logs without a season keep the old 'Season' pill. When every
// one of ten board logs is this season the sample may be cut off, so the true
// count is unknown and the pill is left out rather than repeating L10.
function seasonPill(games, stat, line) {
  const newest = games[0]?.season
  if (newest == null || String(newest).trim() === '') {
    return pillFromRate('season', 'Season', computeRate(games, stat, line))
  }
  const seasonGames = newestSeasonLogs(games, newest)
  if (seasonGames.length >= BOARD_LOG_LIMIT && seasonGames.length === games.length) return null
  return pillFromRate('season', seasonShortLabel(newest, 'Season'), computeRate(seasonGames, stat, line))
}

// Board strip. Full windows only: the NBA chart does not label a short sample.
// When the box score is missing a stat, the chart falls back to the saved
// newest-first L10 series, which can fill L5 and L10 and nothing else.
export function nbaHitPills(games, stat, line, opponent, series = null) {
  const supported = logsSupport(games, stat) ? games : []
  if (supported.length) {
    return [
      fixedLogPill(supported, stat, line, 5, 'l5', 'L5'),
      fixedLogPill(supported, stat, line, 10, 'l10', 'L10'),
      fixedLogPill(supported, stat, line, 20, 'l20', 'L20'),
      pillFromRate('h2h', 'H2H', computeH2H(supported, stat, line, opponent)),
      seasonPill(supported, stat, line),
    ].filter(Boolean)
  }
  return windowPills(series, line)
}

export function dvpGrade(rank, teamCount = NBA_TEAM_COUNT) {
  const value = num(rank)
  if (!value) return null
  const pct = value / teamCount
  if (pct >= 0.9) return 'A+'
  if (pct >= 0.78) return 'A'
  if (pct >= 0.66) return 'A-'
  if (pct >= 0.56) return 'B+'
  if (pct >= 0.46) return 'B'
  if (pct >= 0.36) return 'B-'
  if (pct >= 0.26) return 'C+'
  if (pct >= 0.16) return 'C'
  if (pct >= 0.1) return 'C-'
  if (pct >= 0.06) return 'D+'
  if (pct >= 0.03) return 'D'
  return 'F'
}

const DVP_RED = [255, 123, 121]
const DVP_NEUTRAL = [120, 145, 138]
const DVP_GREEN = [127, 255, 104]

function mixColor(a, b, t) {
  return a.map((channel, index) => Math.round(channel + (b[index] - channel) * t))
}

export function dvpColor(rank, teamCount = NBA_TEAM_COUNT) {
  const value = num(rank)
  if (!value) return null
  const clamped = Math.max(1, Math.min(teamCount, value))
  const mid = teamCount / 2
  const [r, g, b] = clamped <= mid
    ? mixColor(DVP_RED, DVP_NEUTRAL, (clamped - 1) / Math.max(1, mid - 1))
    : mixColor(DVP_NEUTRAL, DVP_GREEN, (clamped - mid) / mid)
  return `rgb(${r}, ${g}, ${b})`
}

function percent(value) {
  const n = num(value)
  return n == null ? null : Math.round(n)
}

function rosterMatch(player, byId, byName) {
  const id = player?.athleteId == null ? '' : String(player.athleteId)
  if (id && byId.has(id)) return byId.get(id)
  const name = String(player?.name || '').trim().toLowerCase()
  return name && byName.has(name) ? byName.get(name) : null
}

function gameLogs(player, rosterPlayer) {
  const direct = player?.gameLogs || player?.recentGames
  if (Array.isArray(direct) && direct.length) return direct
  const joined = rosterPlayer?.gameLogs || rosterPlayer?.recentGames
  return Array.isArray(joined) ? joined : []
}

export function buildPropRows(projections, players) {
  const byId = new Map()
  const byName = new Map()
  ;(Array.isArray(players) ? players : []).forEach((player) => {
    if (player?.athleteId != null && player.athleteId !== '') byId.set(String(player.athleteId), player)
    const name = String(player?.name || '').trim().toLowerCase()
    if (name) byName.set(name, player)
  })

  const rows = []
  ;(Array.isArray(projections) ? projections : []).forEach((player) => {
    const rosterPlayer = rosterMatch(player, byId, byName)
    const logs = gameLogs(player, rosterPlayer)
    const imageUrl = rosterPlayer?.image || player?.image || null
    const position = rosterPlayer?.position || player?.position || ''
    const team = player?.team || rosterPlayer?.team || ''
    ;(player?.ppAllProps || []).forEach((prop) => {
      if (!prop || EXCLUDED_PROP_LABELS.has(prop.stat)) return
      const rawLine = num(prop.line)
      const standard = num(prop.standardLine)
      const oddsType = explicitBoardOddsType(prop)
      const promoLine = oddsType === 'demon' || oddsType === 'goblin'
      const line = promoLine ? rawLine : (standard ?? rawLine)
      const projection = num(prop.projection)
      const score = boundCg(cgScore(projection, line, prop.stat))
      if (projection == null || line == null || line <= 0 || score == null) return

      const recentGames = logsSupport(logs, prop.stat) ? logs : []
      const l10Games = recentGames.slice(0, 10)
      let l10Obj = computeRate(l10Games, prop.stat, line)
      const seasonObj = computeRate(recentGames, prop.stat, line)
      const h2hObj = computeH2H(recentGames, prop.stat, line, prop.opponent ?? null)
      let recentBars = l10Obj
        ? gameChartBars(l10Games, (game) => statValue(game, prop.stat), (game) => opponentFromMatchup(game?.matchup))
        : []
      let recent = recentBars.map((bar) => bar.value)
      if (!recent.length) {
        const series = storedL10Values(prop)
        if (series) {
          l10Obj = rateFromSeries(series, line)
          recent = series.slice().reverse()
          recentBars = recent.map((value) => ({ value, date: '', team: '' }))
        }
      }
      const storedL10 = percent(prop.hitRates?.L10)
      const storedSeason = percent(prop.hitRates?.FULL)
      const gamesPlayed = l10Obj
        ? l10Obj.total
        : (storedL10 == null ? 0 : Math.min(10, num(player.gp) || num(rosterPlayer?.gp) || 10))

      rows.push({
        id: promoLine
          ? `${player.athleteId || player.name}-${prop.stat}-${line}-${oddsType}`
          : `${player.athleteId || player.name}-${prop.stat}-${line}`,
        oddsType: oddsType || null,
        player: player.name,
        team,
        position,
        imageUrl,
        opponent: prop.opponent ?? null,
        prop: prop.stat,
        line,
        projection,
        score,
        side: pickSide(projection, line, score),
        isOver: pickSide(projection, line, score) === 'OVER',
        recent,
        recentBars,
        hitRate: l10Obj ? Math.round(l10Obj.pct) : (storedL10 ?? 0),
        gamesPlayed,
        seasonHitRate: seasonObj ? Math.round(seasonObj.pct) : storedSeason,
        h2hHitRate: h2hObj ? Math.round(h2hObj.pct) : null,
        hitPills: nbaHitPills(recentGames, prop.stat, line, prop.opponent ?? null, storedL10Values(prop)),
        dvpRank: num(prop.effectiveDvpRank),
        avgMins: player?.avgMins ?? null,
        _player: { name: player.name, team, image: imageUrl },
        _hit: l10Obj,
        _edgePct: rawLine && rawLine > 0 ? ((projection - rawLine) / rawLine) * 100 : 0,
        // Uncapped score behind the shown one. Sort tiebreak only at the 100 cap.
        _rawScore: cgScore(projection, line, prop.stat),
      })
    })
  })
  return rows
}

// Same rounding as the minutes pill: round first, then compare. Blank,
// empty, and non-numeric minutes never match a bucket, so they stay on All.
export function passesMinutesBucket(value, bucket) {
  if (!bucket || bucket === 'All') return true
  const minutes = expectedMinutesPill(value)?.minutes
  if (minutes == null) return false
  if (bucket === '30+') return minutes >= 30
  if (bucket === '20+') return minutes >= 20
  if (bucket === 'Under 20') return minutes < 20
  return true
}

function rawMinutes(value) {
  if (expectedMinutesPill(value) == null) return null
  const n = typeof value === 'number' ? value : Number(String(value).trim())
  return Number.isFinite(n) ? n : null
}

function compareCgScore(a, b) {
  return (b.score - a.score) || ((b._rawScore ?? 0) - (a._rawScore ?? 0))
}

// CG Score filter bounds. Empty and non-numeric mean no bound. A number is
// clamped to 0-100. The edited side wins when the two cross, so min stays <= max.
export const CG_BOUND_MIN = 0
export const CG_BOUND_MAX = 100

export function cgBoundNumber(value) {
  if (value == null) return null
  const text = String(value).trim()
  if (text === '' || text === '.') return null
  const n = Number(text)
  if (!Number.isFinite(n)) return null
  return Math.min(CG_BOUND_MAX, Math.max(CG_BOUND_MIN, n))
}

export function cgBoundInput(value) {
  const text = String(value ?? '').trim()
  if (text === '') return ''
  if (text === '.') return '0.'
  const n = Number(text)
  if (!Number.isFinite(n)) return ''
  if (n > CG_BOUND_MAX) return String(CG_BOUND_MAX)
  if (n < CG_BOUND_MIN) return String(CG_BOUND_MIN)
  if (/^\d+\.$/.test(text)) return `${n}.`
  const [whole, frac] = text.split('.')
  if (frac == null || text.startsWith('-')) return String(n)
  return `${String(Number(whole || '0'))}.${frac}`
}

export function cgBoundsAfterEdit(filters, key, raw) {
  const edgeMin = key === 'edgeMin' ? cgBoundInput(raw) : cgBoundInput(filters?.edgeMin)
  const edgeMax = key === 'edgeMax' ? cgBoundInput(raw) : cgBoundInput(filters?.edgeMax)
  if (edgeMin !== '' && edgeMax !== '' && Number(edgeMin) > Number(edgeMax)) {
    if (key === 'edgeMin') return { edgeMin, edgeMax: edgeMin }
    return { edgeMin: edgeMax, edgeMax }
  }
  return { edgeMin, edgeMax }
}

export function filterAndSortRows(allRows, propTab, filters) {
  const low = cgBoundNumber(filters.edgeMin)
  const high = cgBoundNumber(filters.edgeMax)
  let edgeMin = low == null ? -Infinity : low
  let edgeMax = high == null ? Infinity : high
  if (edgeMin > edgeMax) {
    const swap = edgeMin
    edgeMin = edgeMax
    edgeMax = swap
  }
  const lineMin = filters.lineMin === '' ? -Infinity : Number(filters.lineMin)
  const lineMax = filters.lineMax === '' ? Infinity : Number(filters.lineMax)

  const filtered = allRows
    .filter((item) => propTab === 'All Props' || item.prop === propTab)
    .filter((item) => filters.side === 'All' || (filters.side === 'Overs' ? item.side === 'OVER' : item.side === 'UNDER'))
    .filter((item) => item.hitRate >= filters.minHitRate)
    .filter((item) => item.gamesPlayed >= filters.minGames)
    .filter((item) => filters.position === 'All' || item.position === filters.position)
    .filter((item) => item.score >= edgeMin && item.score <= edgeMax)
    .filter((item) => item.line >= lineMin && item.line <= lineMax)
    .filter((item) => passesMinutesBucket(item.avgMins, filters.minutes))
    .filter((item) => {
      if (filters.grade === 'All Grades') return true
      const grade = dvpGrade(item.dvpRank)
      return grade && grade[0] === filters.grade
    })

  return filtered.sort((a, b) => {
    if (filters.sortBy === 'CG Score') return (b.score - a.score) || ((b._rawScore ?? 0) - (a._rawScore ?? 0))
    if (filters.sortBy === MINUTES_SORT) {
      const am = rawMinutes(a.avgMins)
      const bm = rawMinutes(b.avgMins)
      if (am == null && bm == null) return compareCgScore(a, b)
      if (am == null) return 1
      if (bm == null) return -1
      if (bm !== am) return bm - am
      return compareCgScore(a, b)
    }
    if (filters.sortBy === `${SEASON_LABEL} Hit Rate`) return (b.seasonHitRate ?? -1) - (a.seasonHitRate ?? -1)
    if (filters.sortBy === 'H2H Hit Rate') return (b.h2hHitRate ?? -1) - (a.h2hHitRate ?? -1)
    if (filters.sortBy === 'DVP Rank') return (b.dvpRank ?? 0) - (a.dvpRank ?? 0)
    return b.hitRate - a.hitRate
  })
}

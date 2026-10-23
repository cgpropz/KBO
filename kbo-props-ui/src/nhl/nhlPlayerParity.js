// NHL player page parity with the NBA page. Display only: nothing here feeds a
// projection, the CG Score, ranking, pricing or gating.
//
// Two kinds of data:
// 1. Board values (always on): today's PrizePicks line, the board projection
//    and the CG Score, computed exactly as the NHL prop board does
//    (cgScore(projection, line, prop), pickSide). A blank projection or no
//    line shows Pending, never 0.
// 2. NHL API game logs (behind NHL_API_SECTIONS_APPROVED, off): row.nhlApiLog,
//    written by nhl/ui_game_logs.py from api.nhle.com/stats/rest. These drive
//    the TOI / PP TOI sliders, the usage trends, Splits and Advanced stats.
//    Nothing in this file reads the MoneyPuck logs (log / logDates / profile).

import { cgScore } from '../cgScore.js'
import { pickSide } from '../pickSide.js'
import { parseGameDay, meanOf, ratio, sumOf } from '../playerInsights/insightsCore.js'
import { inRange, metricBounds, resolveRange } from '../nba/nbaGameFilters.js'
import { averageMetric, trendDirection, EARLY_SEASON_GAMES } from '../nba/nbaMinutesUsage.js'

// Legal has not ruled on the NHL API terms. Flip only with that sign-off.
export const NHL_API_SECTIONS_APPROVED = false

// Local preview only: a dev build (vite dev server) with ?nhlApiPreview=1.
// A production build ignores the URL, so only the constant above can turn the
// sections on for members.
export function nhlApiSectionsOn({
  approved = NHL_API_SECTIONS_APPROVED,
  dev = Boolean(import.meta.env?.DEV),
  search = typeof window === 'undefined' ? '' : window.location.search,
} = {}) {
  if (approved) return true
  if (!dev) return false
  try {
    return new URLSearchParams(search || '').get('nhlApiPreview') === '1'
  } catch {
    return false
  }
}

export const PENDING = 'Pending'
export const CURRENT_SEASON = '2026-27'
export const PRIOR_SEASON = '2025-26'

function finite(value) {
  if (value == null || value === '') return null
  const number = Number(value)
  return Number.isFinite(number) ? number : null
}

// ---- Today's line, projection and CG Score (board values) -----------------

export function nhlTodayPick(item) {
  const line = finite(item?.line ?? item?.pp_line)
  const projection = finite(item?.projection)
  if (line == null || line <= 0 || projection == null || projection <= 0) {
    return { line, projection: null, cg: null, side: null }
  }
  const cg = finite(cgScore(projection, line, item?.prop ?? item?.stat))
  return { line, projection, cg, side: cg == null ? null : pickSide(projection, line, cg) }
}

export function pickNumber(value) {
  const number = finite(value)
  if (number == null) return null
  return Number.isInteger(number) ? String(number) : number.toFixed(1)
}

export function cgText(value) {
  const number = finite(value)
  return number == null ? null : number.toFixed(1)
}

const PROP_ORDER = ['Shots On Goal', 'Points', 'Power Play Points', 'Goalie Saves']

// One chip per prop the player has on today's board (standard line first).
export function playerPropRows(rows, player) {
  const name = String(player || '').trim().toLowerCase()
  const byProp = new Map()
  for (const row of Array.isArray(rows) ? rows : []) {
    if (String(row?.player || '').trim().toLowerCase() !== name) continue
    const prop = row.prop || row.stat
    if (!prop) continue
    const current = byProp.get(prop)
    const standard = !row.oddsType || row.oddsType === 'standard'
    if (!current || (standard && current.oddsType && current.oddsType !== 'standard')) byProp.set(prop, row)
  }
  return [...byProp.values()].sort((a, b) => {
    const ai = PROP_ORDER.indexOf(a.prop)
    const bi = PROP_ORDER.indexOf(b.prop)
    return (ai < 0 ? 99 : ai) - (bi < 0 ? 99 : bi)
  })
}

// ---- NHL API game logs ------------------------------------------------------

const SECONDS = new Set(['toi', 'ev', 'pp', 'sh'])

// The compact columnar log from nhl/ui_game_logs.py into game objects, newest
// first. TOI fields become minutes. A malformed log gives [].
export function decodeNhlApiLog(log) {
  if (!log || typeof log !== 'object' || !Array.isArray(log.cols) || !Array.isArray(log.games)) return []
  const kind = log.kind === 'goalie' ? 'goalie' : 'skater'
  const games = []
  for (const values of log.games) {
    if (!Array.isArray(values)) continue
    const game = { kind }
    log.cols.forEach((col, index) => {
      const value = values[index]
      if (col === 'd') game.date = typeof value === 'string' ? value : ''
      else if (col === 's') game.season = value == null ? null : String(value)
      else if (col === 'opp') game.opp = value || ''
      else if (col === 'h') game.home = value === 1 ? true : value === 0 ? false : null
      else if (col === 'res') game.res = value || null
      else if (SECONDS.has(col)) game[col] = finite(value) == null ? null : finite(value) / 60
      else game[col] = finite(value)
    })
    if (!game.date) continue
    games.push(game)
  }
  return games.sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0))
}

export const PROP_FIELD = {
  'Shots On Goal': 'sog',
  Points: 'pts',
  'Power Play Points': 'ppp',
  'Goalie Saves': 'sv',
}

export function propValue(game, prop) {
  const field = PROP_FIELD[prop]
  return field ? finite(game?.[field]) : null
}

// TOI / PP TOI sliders (skaters), TOI (goalies). Minutes.
export const SKATER_FILTERS = [
  { id: 'toi', label: 'TOI', unit: 'min', step: 1, field: 'toi' },
  { id: 'pp', label: 'PP TOI', unit: 'min', step: 0.5, field: 'pp' },
]
export const GOALIE_FILTERS = [
  { id: 'toi', label: 'TOI', unit: 'min', step: 1, field: 'toi' },
]

export function filtersFor(kind) {
  return kind === 'goalie' ? GOALIE_FILTERS : SKATER_FILTERS
}

export function filterBounds(games, filters) {
  const out = {}
  for (const filter of filters) out[filter.id] = metricBounds(games, filter.field, filter.step)
  return out
}

export function resolveFilters(bounds, selections, filters) {
  const out = {}
  for (const filter of filters) out[filter.id] = resolveRange(bounds[filter.id], selections?.[filter.id], filter.step)
  return out
}

export function applyFilters(games, ranges, filters) {
  const active = filters.filter((filter) => ranges[filter.id] && !ranges[filter.id].full)
  if (!active.length) return games
  return games.filter((game) => active.every((filter) => inRange(finite(game[filter.field]), ranges[filter.id])))
}

export function anyNarrowed(ranges) {
  return Object.values(ranges || {}).some((range) => range && !range.full)
}

// The hit-rate windows over NHL API games (newest first in, oldest first out),
// in the same shape the page's chart already draws.
export function apiWindow(games, range, { prop, opponent } = {}) {
  let picked = games
  if (range === 'season') picked = games.filter((game) => game.season === CURRENT_SEASON)
  else if (range === 'prior') picked = games.filter((game) => game.season === PRIOR_SEASON)
  else if (range === 'h2h') picked = opponent ? games.filter((game) => game.opp === opponent) : []
  else if (range === 'l5' || range === 'l10' || range === 'l20' || range === 'l30') {
    picked = games.slice(0, Number(range.slice(1)))
  }
  return picked.slice().reverse().map((game) => ({
    value: propValue(game, prop),
    date: game.date,
    season: game.season || '',
    team: '',
    opponent: game.opp || '',
    game,
  }))
}

// ---- Usage trends (L5 vs this season) ---------------------------------------

// Gap that counts as a trend. Below it the arrow is flat.
export const SKATER_TRENDS = [
  { id: 'toi', field: 'toi', label: 'Time on ice', short: 'TOI', unit: 'ice', threshold: 1.5 },
  { id: 'sog', field: 'sog', label: 'Shots on goal', short: 'SOG', unit: 'count', threshold: 0.5 },
  { id: 'pp', field: 'pp', label: 'Power-play time', short: 'PP TOI', unit: 'ice', threshold: 0.5 },
]
export const GOALIE_TRENDS = [
  { id: 'toi', field: 'toi', label: 'Time on ice', short: 'TOI', unit: 'ice', threshold: 3 },
  { id: 'sa', field: 'sa', label: 'Shots against', short: 'SA', unit: 'count', threshold: 2 },
  { id: 'sv', field: 'sv', label: 'Saves', short: 'SV', unit: 'count', threshold: 2 },
]

export function trendsFor(kind) {
  return kind === 'goalie' ? GOALIE_TRENDS : SKATER_TRENDS
}

function trendValue(game, field) {
  const value = finite(game?.[field])
  if (value == null) return null
  if (field === 'toi' && value <= 0) return null
  return value
}

function valued(games, field) {
  return games.map((game) => ({ [field]: trendValue(game, field) })).filter((game) => game[field] != null)
}

// L5 / L10 over the newest games, Season over this season's games. No arrow
// until EARLY_SEASON_GAMES games this season have a value.
export function nhlTrendSummary(games, metric) {
  const list = Array.isArray(games) ? games : []
  const all = valued(list, metric.field)
  const season = valued(list.filter((game) => game.season === CURRENT_SEASON), metric.field)
  const l5 = averageMetric(all.slice(0, 5), metric.field)
  const l10 = averageMetric(all.slice(0, 10), metric.field)
  const seasonAvg = averageMetric(season, metric.field)
  const ready = season.length >= EARLY_SEASON_GAMES
  return {
    l5,
    l10,
    season: seasonAvg,
    seasonGames: season.length,
    trend: ready ? trendDirection(averageMetric(season.slice(0, 5), metric.field), seasonAvg, metric.threshold) : null,
  }
}

export function formatIceMinutes(minutes) {
  const value = finite(minutes)
  if (value == null) return '—'
  const total = Math.max(0, Math.round(value * 60))
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, '0')}`
}

export function formatTrend(value, unit) {
  const number = finite(value)
  if (number == null) return '—'
  if (unit === 'ice') return formatIceMinutes(number)
  return number.toFixed(1)
}

export function trendBarLabel(value, unit) {
  const number = finite(value)
  if (number == null) return ''
  if (unit === 'ice') return String(Math.round(number))
  return Number.isInteger(number) ? String(number) : number.toFixed(1)
}

// ---- Splits + Advanced model for PlayerInsights -----------------------------

const SKATER_METRICS = [
  {
    id: 'shPct', label: 'Shooting %', format: 'pct',
    note: 'Goals on shots on goal.',
    has: (g) => g.sog != null && g.g != null,
    total: (rows) => ratio(sumOf(rows, 'g'), sumOf(rows, 'sog')),
    game: (g) => (g.sog > 0 ? g.g / g.sog : null),
  },
  {
    id: 'sog60', label: 'SOG / 60', format: 'two',
    note: 'Shots on goal per 60 minutes on ice, all situations.',
    has: (g) => g.sog != null && g.toi > 0,
    total: (rows) => ratio(sumOf(rows, 'sog'), sumOf(rows, 'toi'), 60),
    game: (g) => (g.toi > 0 ? (g.sog / g.toi) * 60 : null),
  },
  {
    id: 'ppPts', label: 'PP points / game', format: 'two',
    note: 'Power-play goals plus assists, per game.',
    has: (g) => g.ppp != null,
    total: (rows) => meanOf(rows, 'ppp'),
    game: (g) => g.ppp,
  },
  {
    id: 'evToi', label: 'EV TOI / game (min)', format: 'one',
    note: 'Even-strength minutes per game.',
    has: (g) => g.ev != null,
    total: (rows) => meanOf(rows, 'ev'),
    game: (g) => g.ev,
  },
  {
    id: 'ppToi', label: 'PP TOI / game (min)', format: 'one',
    note: 'Power-play minutes per game.',
    has: (g) => g.pp != null,
    total: (rows) => meanOf(rows, 'pp'),
    game: (g) => g.pp,
  },
  {
    id: 'shToi', label: 'SH TOI / game (min)', format: 'one',
    note: 'Shorthanded minutes per game.',
    has: (g) => g.sh != null,
    total: (rows) => meanOf(rows, 'sh'),
    game: (g) => g.sh,
  },
  {
    id: 'ppShare', label: 'PP share of TOI', format: 'pct',
    note: 'Power-play minutes as a share of all his minutes.',
    has: (g) => g.pp != null && g.toi > 0,
    total: (rows) => ratio(sumOf(rows, 'pp'), sumOf(rows, 'toi')),
    game: (g) => (g.toi > 0 ? g.pp / g.toi : null),
  },
  {
    id: 'foPct', label: 'Faceoff %', format: 'pct', faceoffs: true,
    note: 'Faceoffs won on faceoffs taken.',
    has: (g) => g.fot > 0,
    total: (rows) => ratio(sumOf(rows, 'fow'), sumOf(rows, 'fot')),
    game: (g) => (g.fot > 0 ? g.fow / g.fot : null),
  },
  {
    id: 'blocks', label: 'Blocks / game', format: 'one',
    note: 'Opponent shots he blocked, per game.',
    has: (g) => g.blk != null,
    total: (rows) => meanOf(rows, 'blk'),
    game: (g) => g.blk,
  },
  {
    id: 'hits', label: 'Hits / game', format: 'one',
    note: 'Hits credited, per game.',
    has: (g) => g.hit != null,
    total: (rows) => meanOf(rows, 'hit'),
    game: (g) => g.hit,
  },
  {
    id: 'pts60', label: 'Points / 60', format: 'two',
    note: 'Goals plus assists per 60 minutes on ice.',
    has: (g) => g.pts != null && g.toi > 0,
    total: (rows) => ratio(sumOf(rows, 'pts'), sumOf(rows, 'toi'), 60),
    game: (g) => (g.toi > 0 ? (g.pts / g.toi) * 60 : null),
  },
  {
    id: 'shifts', label: 'Shifts / game', format: 'one',
    note: 'Shifts per game.',
    has: (g) => g.shf != null,
    total: (rows) => meanOf(rows, 'shf'),
    game: (g) => g.shf,
  },
]

const GOALIE_METRICS = [
  {
    id: 'svPct', label: 'Save %', format: 'avg3',
    note: 'Saves on shots against.',
    has: (g) => g.sa > 0 && g.sv != null,
    total: (rows) => ratio(sumOf(rows, 'sv'), sumOf(rows, 'sa')),
    game: (g) => (g.sa > 0 ? g.sv / g.sa : null),
  },
  {
    id: 'gaa', label: 'Goals against avg', format: 'two',
    note: 'Goals against per 60 minutes in net.',
    has: (g) => g.ga != null && g.toi > 0,
    total: (rows) => ratio(sumOf(rows, 'ga'), sumOf(rows, 'toi'), 60),
    game: (g) => (g.toi > 0 ? (g.ga / g.toi) * 60 : null),
  },
  {
    id: 'saves', label: 'Saves / game', format: 'one',
    note: 'Saves per game.',
    has: (g) => g.sv != null,
    total: (rows) => meanOf(rows, 'sv'),
    game: (g) => g.sv,
  },
  {
    id: 'sa', label: 'Shots against / game', format: 'one',
    note: 'Shots on goal he faced, per game.',
    has: (g) => g.sa != null,
    total: (rows) => meanOf(rows, 'sa'),
    game: (g) => g.sa,
  },
]

// Not shown, with the reason. Each of these exists only in MoneyPuck data,
// which the new sections do not use.
export const MONEYPUCK_ONLY = {
  skater: [
    'Expected goals (xG / ixG): MoneyPuck only, not in the NHL API.',
    '5-on-5 splits: MoneyPuck only. The NHL API gives even-strength (EV) time, shown instead.',
    'Shot attempts (Corsi), missed and blocked attempts, high-danger chances: MoneyPuck only.',
  ],
  goalie: [
    'Goals saved above expected (GSAx): MoneyPuck only, not in the NHL API.',
    'High-danger save %: MoneyPuck only.',
  ],
}

function yearFor(season) {
  const start = Number(String(season || '').slice(0, 4))
  return (month) => (start > 0 ? (month >= 8 ? start : start + 1) : null)
}

export function nhlApiInsights(item, games) {
  const list = Array.isArray(games) ? games : []
  const kind = list[0]?.kind === 'goalie' || item?.prop === 'Goalie Saves' ? 'goalie' : 'skater'
  const faceoffs = list.some((game) => game.fot > 0)
  const metrics = (kind === 'goalie' ? GOALIE_METRICS : SKATER_METRICS)
    .filter((metric) => !metric.faceoffs || faceoffs)
  return {
    sport: 'nhl',
    games: list.map((game) => ({
      raw: game,
      value: propValue(game, item?.prop),
      day: parseGameDay(game.date, yearFor(game.season)),
      season: game.season,
      opp: game.opp || null,
      home: game.home,
      // Overtime and shootout losses count as team losses.
      result: game.res === 'W' ? 'W' : game.res === 'L' || game.res === 'OTL' ? 'L' : null,
      oppHand: null,
    })),
    opponent: item?.opponent || null,
    currentSeason: CURRENT_SEASON,
    priorSeason: PRIOR_SEASON,
    seasonLabel: (season) => String(season ?? ''),
    restApplies: true,
    handApplies: false,
    metrics,
    unavailable: MONEYPUCK_ONLY[kind],
    advancedNote: 'No NHL API game logs for this player yet.',
    splitsBlocked: list.length ? null : 'No NHL API game logs for this player yet.',
  }
}

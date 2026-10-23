// Per-game view of one NFL player for the player page: today's projection and
// CG Score cell, the game filters, and the Snaps & Usage trends.
// Display only. Every value comes from the board rows the page already loaded
// (recent, gameDates, gameSeasons, gameOpponents, recentSnapPercents,
// recentUsage, recentDvpRanks, teammateOn, and the player's other prop rows).
// Nothing here feeds a projection, the CG Score, ranking, gating or pricing.

import { cgSide, lineMatchesStat } from '../cgScore.js'
import { nflCgScore } from './nflLineFloors.js'
import { gameMetric, inRange, metricBounds, resolveRange } from '../nba/nbaGameFilters.js'
import { EARLY_SEASON_GAMES, trendDirection } from '../nba/nbaMinutesUsage.js'

export const PENDING = 'Pending'

function finite(value) {
  if (value == null || value === '') return null
  const number = Number(value)
  return Number.isFinite(number) ? number : null
}

function list(value) {
  return Array.isArray(value) ? value : []
}

function gameKey(season, date) {
  return `${season ?? ''}|${date ?? ''}`
}

// ---- Today's pick ----------------------------------------------------------

// { projection, cg, side } for the selected prop at today's posted line. The
// CG Score is the board's own nflCgScore call for that row. A missing line, a
// line the board would not post, or a blank projection (null, not a number,
// or not above 0) gives nulls, so the page shows Pending and never 0.
export function nflTodayPick(row) {
  const line = finite(row?.line)
  const projection = finite(row?.projection)
  if (line == null || line <= 0 || !lineMatchesStat(row?.prop, line) || projection == null || projection <= 0) {
    return { projection: null, cg: null, side: null }
  }
  const cg = finite(nflCgScore(projection, line, row?.prop))
  return { projection, cg, side: cg == null ? null : cgSide(cg) }
}

export function pickText(value) {
  const number = finite(value)
  return number == null ? null : number.toFixed(1)
}

// ---- Game log --------------------------------------------------------------

function propSeries(rows, prop) {
  const row = list(rows).find((item) => item?.prop === prop)
  if (!row) return null
  const dates = list(row.gameDates)
  const seasons = list(row.gameSeasons)
  const map = new Map()
  list(row.recent).forEach((value, index) => {
    if (dates[index] != null) map.set(gameKey(seasons[index], dates[index]), finite(value))
  })
  return map
}

// One entry per logged game, in the row's order (oldest first). Volume stats
// come from the row's usage column when it is that stat, otherwise from the
// player's own prop row for it, matched by season and week date. A stat with
// neither source is null; nothing is filled in.
//   touches = rush attempts + receptions, only when both are known.
export function nflGameLog(row, rows = []) {
  const recent = list(row?.recent)
  const dates = list(row?.gameDates)
  const seasons = list(row?.gameSeasons)
  const opponents = list(row?.gameOpponents)
  const snaps = list(row?.recentSnapPercents)
  const usage = list(row?.recentUsage)
  const dvp = list(row?.recentDvpRanks)
  const teammateOn = list(row?.teammateOn)
  const usageLabel = row?.usageLabel || ''
  const series = {
    targets: propSeries(rows, 'Rec Targets'),
    carries: propSeries(rows, 'Rush Attempts'),
    passAtt: propSeries(rows, 'Pass Attempts'),
    receptions: propSeries(rows, 'Receptions'),
    recYds: propSeries(rows, 'Receiving Yards'),
    rushYds: propSeries(rows, 'Rush Yards'),
  }
  const usageFor = { targets: 'Targets', carries: 'Rush Att', passAtt: 'Pass Att' }
  return recent.map((value, index) => {
    const key = gameKey(seasons[index], dates[index])
    const used = finite(usage[index])
    const pick = (field) => {
      if (usageFor[field] && usageFor[field] === usageLabel && used != null) return used
      const map = series[field]
      return map && map.has(key) ? map.get(key) : null
    }
    const carries = pick('carries')
    const receptions = pick('receptions')
    return {
      index,
      date: dates[index] ?? null,
      season: seasons[index] != null ? String(seasons[index]) : null,
      opp: opponents[index] ?? null,
      value: finite(value),
      snap: finite(snaps[index]),
      usage: used,
      dvp: finite(dvp[index]),
      teammateOn: teammateOn[index],
      targets: pick('targets'),
      carries,
      passAtt: pick('passAtt'),
      receptions,
      touches: carries != null && receptions != null ? carries + receptions : null,
      recYds: pick('recYds'),
      rushYds: pick('rushYds'),
    }
  })
}

// ---- Filters ---------------------------------------------------------------

const USAGE_UNITS = { Targets: 'tgt', 'Rush Att': 'att', 'Pass Att': 'att' }

// The sliders this player gets. A filter whose stat has no logged values is
// left out. Def rank: 1 = toughest matchup, 32 = easiest.
export function nflGameFilters(row, games) {
  const usageLabel = row?.usageLabel || 'Usage'
  const candidates = [
    { id: 'snap', field: 'snap', label: 'Snap %', unit: '%', step: 1 },
    { id: 'usage', field: 'usage', label: usageLabel, unit: USAGE_UNITS[usageLabel] || '', step: 1 },
    ...(usageLabel !== 'Targets' ? [{ id: 'targets', field: 'targets', label: 'Targets', unit: 'tgt', step: 1 }] : []),
    { id: 'touches', field: 'touches', label: 'Touches', unit: 'tch', step: 1 },
    { id: 'dvp', field: 'dvp', label: 'Def rank', unit: '', step: 1, fixed: { min: 1, max: 32 } },
  ]
  return candidates
    .map((filter) => {
      const bounds = metricBounds(games, filter.field, filter.step)
      if (!bounds) return null
      return { ...filter, bounds: filter.fixed ? { ...filter.fixed, count: bounds.count } : bounds }
    })
    .filter(Boolean)
}

export function resolveFilterRanges(filters, selections = {}) {
  const ranges = {}
  filters.forEach((filter) => { ranges[filter.id] = resolveRange(filter.bounds, selections[filter.id], filter.step) })
  return ranges
}

export function gamePassesRanges(game, filters, ranges) {
  return filters.every((filter) => inRange(gameMetric(game, filter.field), ranges[filter.id]))
}

export function rangesActive(ranges) {
  return Object.values(ranges || {}).some((range) => range && !range.full)
}

// ---- Snaps & Usage trends --------------------------------------------------

// L5 vs this-season gap that counts as a trend, per stat.
const TREND_STATS = {
  snap: { id: 'snap', field: 'snap', label: 'Snap %', unit: '%', threshold: 5 },
  touches: { id: 'touches', field: 'touches', label: 'Touches', unit: '', threshold: 1.5 },
  targets: { id: 'targets', field: 'targets', label: 'Targets', unit: '', threshold: 1 },
  receptions: { id: 'receptions', field: 'receptions', label: 'Receptions', unit: '', threshold: 1 },
  carries: { id: 'carries', field: 'carries', label: 'Rush Att', unit: '', threshold: 1.5 },
  passAtt: { id: 'passAtt', field: 'passAtt', label: 'Pass Att', unit: '', threshold: 3 },
}

const TREND_BY_POSITION = {
  QB: ['snap', 'passAtt', 'carries'],
  RB: ['snap', 'touches', 'targets'],
  FB: ['snap', 'touches', 'targets'],
}
const TREND_DEFAULT = ['snap', 'targets', 'receptions']

export function nflTrendMetrics(row, games) {
  const ids = TREND_BY_POSITION[String(row?.position || '').toUpperCase()] || TREND_DEFAULT
  return ids
    .map((id) => TREND_STATS[id])
    .filter((metric) => games.some((game) => gameMetric(game, metric.field) != null))
}

function averageOf(games, field) {
  const values = games.map((game) => gameMetric(game, field)).filter((value) => value != null)
  return values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : null
}

// newestFirst: every logged game, newest first. L5 / L10 are the newest five /
// ten games with a value. Season is this season's average. The arrow compares
// L5 with this season once there are EARLY_SEASON_GAMES games with a value
// this season; before that there is no arrow.
export function nflTrendSummary(newestFirst, metric, currentSeason) {
  const valued = newestFirst.filter((game) => gameMetric(game, metric.field) != null)
  const season = currentSeason == null ? valued : valued.filter((game) => game.season === String(currentSeason))
  const l5 = averageOf(valued.slice(0, 5), metric.field)
  const seasonAvg = averageOf(season, metric.field)
  const baseline = season.length >= EARLY_SEASON_GAMES ? seasonAvg : null
  return {
    l5,
    l10: averageOf(valued.slice(0, 10), metric.field),
    season: seasonAvg,
    seasonGames: season.length,
    trend: baseline == null ? null : trendDirection(l5, baseline, metric.threshold),
  }
}

export function formatTrend(value, unit = '') {
  if (value == null || !Number.isFinite(value)) return '—'
  const text = Math.abs(value) >= 10 || unit === '%' ? String(Math.round(value)) : value.toFixed(1)
  return unit === '%' ? `${text}%` : text
}

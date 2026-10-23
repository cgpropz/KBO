// Minutes & Usage trends for the NBA player page and Players list cards.
// Display only: nothing here feeds a projection, an edge, or a CG Score.
//
// Minutes come from `game.min` and usage % from `game.usg`, the per-game
// values the NBA refresh stores in each player's gameLogs (newest first). A
// blank, non-numeric value, or a minutes value of 0 (did not play) is left out
// of the averages. No value is filled in when a game has none.

import { gameMetric, newestSeasonLogs } from './nbaGameFilters.js'

// L5 vs Season gap that counts as a trend: 1.5 minutes or 1.5 usage points.
export const TREND_THRESHOLD = 1.5

export const TREND_METRICS = [
  { id: 'min', field: 'min', label: 'Minutes', short: 'MIN', unit: 'min' },
  { id: 'usg', field: 'usg', label: 'Usage %', short: 'USG', unit: '%' },
]

export const TREND_COLORS = { up: '#22c55e', down: '#ef4444', flat: '#9ca3af' }
export const TREND_ARROWS = { up: '↑', down: '↓', flat: '→' }

export function metricValue(game, field) {
  const value = gameMetric(game, field)
  if (value == null) return null
  if (field === 'min' && value <= 0) return null
  return value
}

export function averageMetric(games, field) {
  const values = (games || []).map((game) => metricValue(game, field)).filter((value) => value != null)
  if (!values.length) return null
  return values.reduce((sum, value) => sum + value, 0) / values.length
}

// up / down / flat for L5 against Season. A gap of exactly the threshold is
// flat. Either average missing: no arrow (null).
export function trendDirection(recent, season, threshold = TREND_THRESHOLD) {
  if (recent == null || season == null || !Number.isFinite(recent) || !Number.isFinite(season)) return null
  const gap = Math.round((recent - season) * 1e6) / 1e6
  if (gap > threshold) return 'up'
  if (gap < -threshold) return 'down'
  return 'flat'
}

// Games this season before there is a trend arrow. Below it: no arrow.
export const EARLY_SEASON_GAMES = 5

function valuedCount(games, field) {
  return games.filter((game) => metricValue(game, field) != null).length
}

// What the arrow compares L5 against: this season's average, once there are
// EARLY_SEASON_GAMES or more games with a value this season. Fewer: null, so
// there is no arrow (last season is not used).
export function trendBaseline(logs, field) {
  const games = Array.isArray(logs) ? logs : []
  const current = games[0]?.season
  const thisSeason = newestSeasonLogs(games, current)
  if (valuedCount(thisSeason, field) < EARLY_SEASON_GAMES) return null
  return { value: averageMetric(thisSeason, field), season: current ?? null }
}

// L5 / L10 count the newest logged games (as the hit-rate chips do). Season is
// the newest season in the log. The arrow uses trendBaseline.
export function metricSummary(logs, field) {
  const games = Array.isArray(logs) ? logs : []
  const l5 = averageMetric(games.slice(0, 5), field)
  const l10 = averageMetric(games.slice(0, 10), field)
  const season = averageMetric(newestSeasonLogs(games, games[0]?.season), field)
  const baseline = trendBaseline(games, field)
  return {
    l5,
    l10,
    season,
    baseline: baseline ? baseline.value : null,
    trend: baseline ? trendDirection(l5, baseline.value) : null,
    games: valuedCount(games, field),
  }
}

// The bars for one window, oldest on the left. `windowGames` is the window the
// hit-rate chart picked from all games, newest first. A game the minutes /
// usage sliders filtered out stays in place, dimmed.
export function trendBars(windowGames, keptGames, field) {
  const kept = keptGames instanceof Set ? keptGames : new Set(keptGames || [])
  const filtering = keptGames != null
  return (windowGames || []).slice().reverse().map((game) => ({
    game,
    value: metricValue(game, field),
    dimmed: filtering ? !kept.has(game) : false,
  }))
}

export function formatTrendValue(value, unit) {
  if (value == null || !Number.isFinite(value)) return '—'
  if (unit === '%') return `${Math.round(value)}%`
  return value.toFixed(1)
}

// "MIN ↑ 31.2" / "USG ↓ 22%" for a list card. Null when the player has no
// value for that metric. No arrow under EARLY_SEASON_GAMES games this season.
export function cardTrend(player, metric) {
  const summary = metricSummary(player?.gameLogs, metric.field)
  if (summary.l5 == null) return null
  const trend = summary.trend
  return {
    id: metric.id,
    short: metric.short,
    trend,
    arrow: trend ? TREND_ARROWS[trend] : '',
    color: trend ? TREND_COLORS[trend] : TREND_COLORS.flat,
    text: formatTrendValue(summary.l5, metric.unit),
  }
}

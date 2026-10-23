// Splits and advanced-stat math for the player-page Insights preview.
// Display only: everything here is computed from the game logs the page has
// already loaded. Nothing feeds a projection, the CG Score, ranking or gating.
//
// A game is normalized by the sport adapter (insightsSports.js) to:
//   { value, day, season, opp, home, result, oppHand, raw }
// value  - the selected stat for that game (null when not logged)
// day    - whole days since 1970-01-01 (UTC), or null when the date is unknown
// season - season label as the sport writes it
// home   - true / false, or null when the log does not say
// result - 'W' / 'L', or null
// oppHand- 'L' / 'R' (KBO hitters: the opposing starter's hand), or null
// Games arrive newest first.

import { overHitRate } from '../hitRateStrip.js'

export const SMALL_SAMPLE = 5
const DAY_MS = 86400000

function finite(value) {
  if (value == null || value === '') return null
  const number = Number(value)
  return Number.isFinite(number) ? number : null
}

function dayNumber(year, month, date) {
  if (!year || !month || !date) return null
  const ms = Date.UTC(year, month - 1, date)
  return Number.isFinite(ms) ? Math.round(ms / DAY_MS) : null
}

// 'YYYY-MM-DD', 'MM/DD/YYYY' or a bare 'MM/DD' / 'M/D'. A bare date takes its
// year from `yearFor(month)`, which the sport supplies from the season label.
export function parseGameDay(text, yearFor = null) {
  const value = String(text ?? '').trim()
  let match = value.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/)
  if (match) return dayNumber(Number(match[1]), Number(match[2]), Number(match[3]))
  match = value.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/)
  if (match) return dayNumber(Number(match[3]), Number(match[1]), Number(match[2]))
  match = value.match(/^(\d{1,2})\/(\d{1,2})$/)
  if (match && typeof yearFor === 'function') {
    const month = Number(match[1])
    const year = yearFor(month)
    return year ? dayNumber(year, month, Number(match[2])) : null
  }
  return null
}

// Today's date in New York as a day number, the same clock the boards use.
export function todayDay(now = new Date()) {
  try {
    const parts = new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', year: 'numeric', month: 'numeric', day: 'numeric' })
      .formatToParts(now)
    const get = (type) => Number(parts.find((part) => part.type === type)?.value)
    return dayNumber(get('year'), get('month'), get('day'))
  } catch {
    return Math.floor(now.getTime() / DAY_MS)
  }
}

// Days off before each game: 0 is a back-to-back. The first logged game of a
// season has no rest value (the gap is the offseason).
export function withRest(games) {
  return games.map((game, index) => {
    const previous = games[index + 1]
    if (game.day == null || !previous || previous.day == null || previous.season !== game.season) return { ...game, rest: null }
    const gap = game.day - previous.day - 1
    return { ...game, rest: gap >= 0 ? gap : null }
  })
}

function summarize(games, line) {
  const values = games.map((game) => finite(game.value)).filter((value) => value != null)
  const n = values.length
  const avg = n ? values.reduce((sum, value) => sum + value, 0) / n : null
  const rated = line == null ? null : overHitRate(values, line)
  return {
    n,
    avg,
    rate: rated?.rate ?? null,
    hits: rated?.hits ?? 0,
    decided: rated?.games ?? 0,
    small: n > 0 && n < SMALL_SAMPLE,
  }
}

function row(group, id, label, games, line, extra = {}) {
  return { group, id, label, ...summarize(games, line), ...extra }
}

// Every split the logs can support. A split whose field is missing from every
// game is left out (and reported in `skipped`), never shown as 0.
export function buildSplits(games, {
  line = null,
  opponent = null,
  today = todayDay(),
  currentSeason = null,
  priorSeason = null,
  seasonLabel = (season) => String(season ?? ''),
  restApplies = true,
  handApplies = false,
  extraSplits = [],
} = {}) {
  const list = withRest(Array.isArray(games) ? games : [])
  const out = []
  const skipped = []
  const season = currentSeason ?? list[0]?.season ?? null
  const seasonGames = season == null ? list : list.filter((game) => game.season === season)

  out.push(row('Sample', 'season', season == null ? 'All logged' : `${seasonLabel(season)} season`, seasonGames, line, { early: seasonGames.length < 10 }))
  if (priorSeason != null) {
    const prior = list.filter((game) => game.season === priorSeason)
    if (prior.length) out.push(row('Sample', 'prior', `${seasonLabel(priorSeason)} season`, prior, line))
  }
  if (list.some((game) => game.day != null) && today != null) {
    out.push(row('Sample', 'l30d', 'Last 30 days', list.filter((game) => game.day != null && today - game.day <= 30 && today - game.day >= 0), line))
  } else skipped.push('Last 30 days (no game dates)')

  if (list.some((game) => game.home != null)) {
    out.push(row('Venue', 'home', 'Home', list.filter((game) => game.home === true), line))
    out.push(row('Venue', 'away', 'Away', list.filter((game) => game.home === false), line))
  } else skipped.push('Home/Away (logs have no venue)')

  if (opponent) {
    out.push(row('Opponent', 'vsopp', `vs ${opponent}`, list.filter((game) => game.opp === opponent), line))
  } else skipped.push('vs opponent (no game today)')

  if (list.some((game) => game.result === 'W' || game.result === 'L')) {
    out.push(row('Result', 'wins', 'Team wins', list.filter((game) => game.result === 'W'), line))
    out.push(row('Result', 'losses', 'Team losses', list.filter((game) => game.result === 'L'), line))
  } else skipped.push('Wins/Losses (logs have no result)')

  if (restApplies) {
    if (list.some((game) => game.rest != null)) {
      out.push(row('Rest', 'rest0', '0 days rest', list.filter((game) => game.rest === 0), line))
      out.push(row('Rest', 'rest1', '1 day rest', list.filter((game) => game.rest === 1), line))
      out.push(row('Rest', 'rest2', '2+ days rest', list.filter((game) => game.rest != null && game.rest >= 2), line))
    } else skipped.push('Rest days (no game dates)')
  }

  if (handApplies) {
    if (list.some((game) => game.oppHand === 'L' || game.oppHand === 'R')) {
      out.push(row('Pitcher', 'vslhp', 'vs LHP', list.filter((game) => game.oppHand === 'L'), line))
      out.push(row('Pitcher', 'vsrhp', 'vs RHP', list.filter((game) => game.oppHand === 'R'), line))
    } else skipped.push('vs LHP/RHP (no starter hand in logs)')
  }
  // Sport-specific splits ({ group, id, label, test(game) }); a split with no
  // matching games is left out.
  ;(Array.isArray(extraSplits) ? extraSplits : []).forEach((split) => {
    const matched = list.filter((game) => split.test(game))
    if (matched.length) out.push(row(split.group, split.id, split.label, matched, line))
  })
  return { rows: out, skipped, seasonGames: seasonGames.length }
}

// One advanced metric over a set of games. `metric.total(games)` returns the
// aggregate (a rate from summed parts, or a per-game average); `metric.game`
// returns the per-game value for the mini chart.
export function metricWindows(metric, games, { currentSeason = null, priorSeason = null, seasonLabel = (s) => String(s ?? '') } = {}) {
  const list = Array.isArray(games) ? games : []
  const usable = list.filter((game) => metric.has ? metric.has(game.raw) : true)
  const season = currentSeason ?? list[0]?.season ?? null
  const windows = [
    { id: 'l5', label: 'L5', games: usable.slice(0, 5) },
    { id: 'l10', label: 'L10', games: usable.slice(0, 10) },
    { id: 'season', label: season == null ? 'Season' : seasonLabel(season), games: season == null ? usable : usable.filter((game) => game.season === season) },
  ]
  if (priorSeason != null) windows.push({ id: 'prior', label: seasonLabel(priorSeason), games: usable.filter((game) => game.season === priorSeason) })
  return windows.map((window) => {
    const raws = window.games.map((game) => game.raw)
    const value = raws.length ? finite(metric.total(raws)) : null
    return { id: window.id, label: window.label, n: raws.length, value, small: raws.length > 0 && raws.length < SMALL_SAMPLE }
  })
}

export function metricSeries(metric, games, count = 10) {
  const list = (Array.isArray(games) ? games : []).filter((game) => (metric.has ? metric.has(game.raw) : true)).slice(0, count)
  return list.map((game) => ({ day: game.day, opp: game.opp, value: metric.game ? finite(metric.game(game.raw)) : null })).reverse()
}

// Helpers the sport metric tables share.
export function sumOf(rows, key) {
  return rows.reduce((total, row) => total + (finite(typeof key === 'function' ? key(row) : row?.[key]) ?? 0), 0)
}

export function ratio(numerator, denominator, scale = 1) {
  return denominator > 0 ? (numerator / denominator) * scale : null
}

export function meanOf(rows, key) {
  const values = rows.map((row) => finite(typeof key === 'function' ? key(row) : row?.[key])).filter((value) => value != null)
  return values.length ? values.reduce((total, value) => total + value, 0) / values.length : null
}

export function formatMetric(value, format) {
  const number = finite(value)
  if (number == null) return '—'
  switch (format) {
    case 'pct': return `${(number * 100).toFixed(1)}%`
    case 'pct100': return `${number.toFixed(1)}%`
    case 'pctInt': return String(Math.round(number * 100))
    case 'avg3': return number.toFixed(3).replace(/^0\./, '.')
    case 'int': return String(Math.round(number))
    case 'two': return number.toFixed(2)
    default: return number.toFixed(1)
  }
}

export function formatAvg(value) {
  const number = finite(value)
  if (number == null) return '—'
  return Number.isInteger(number) ? String(number) : number.toFixed(1)
}

export function dayLabel(day) {
  if (day == null) return ''
  const date = new Date(day * DAY_MS)
  return `${date.getUTCMonth() + 1}/${date.getUTCDate()}`
}

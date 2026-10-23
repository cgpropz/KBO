// Splits and advanced-stat math for the player-page Splits + Advanced stats.
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
// played - false for a 0-minute basketball row (left out everywhere)
// postseason - true for a WNBA playoff game
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

// Item-1 display choice for windows that reach across seasons (L5/L10 on
// Advanced stats; Venue/Opponent/Result/Rest/Pitcher splits):
//   'all'    - newest logged games whatever the season (shipped behavior)
//   'season' - this season only; L5/L10 hidden under SCOPED_MIN_GAMES games
//   'both'   - newest logged games, labeled "both seasons" when they span two
// A sport adapter sets `recentScope`; flipping it is the whole switch.
export const RECENT_SCOPES = Object.freeze(['all', 'season', 'both'])
export const SCOPED_MIN_GAMES = 5
export const DEFAULT_EARLY_SEASON_GAMES = 10

function summarize(games, line) {
  const values = games.map((game) => finite(game.value)).filter((value) => value != null)
  const n = values.length
  const avg = n ? values.reduce((sum, value) => sum + value, 0) / n : null
  const rated = line == null ? null : overHitRate(values, line)
  const decided = rated?.games ?? 0
  // A push (value equals the line) leaves the hit rate, as on the board strip.
  const pushes = line == null ? 0 : values.filter((value) => Number(value) === Number(line)).length
  const shown = line == null ? n : decided
  return {
    n,
    avg,
    rate: rated?.rate ?? null,
    hits: rated?.hits ?? 0,
    decided,
    pushes,
    shown,
    small: shown > 0 && shown < SMALL_SAMPLE,
  }
}

function row(group, id, label, games, line, extra = {}) {
  return { group, id, label, ...summarize(games, line), ...extra }
}

// Games the player actually played. Basketball marks a 0-minute row
// played: false (same rule as the Minutes & Usage card); other sports leave
// `played` unset.
export function playedGames(games) {
  return (Array.isArray(games) ? games : []).filter((game) => game.played !== false)
}

// The season a capped log cuts short: when the pipeline ships exactly `logCap`
// (or more) rows, the oldest season in it is only partly there.
export function truncatedSeasonOf(games, logCap) {
  const list = Array.isArray(games) ? games : []
  if (!logCap || list.length < logCap) return null
  return list[list.length - 1]?.season ?? null
}

function sampleLabel(season, loggedCount, { seasonLabel, truncatedSeason }) {
  const name = seasonLabel(season)
  return truncatedSeason != null && season === truncatedSeason ? `Last ${loggedCount} games of ${name}` : `${name} season`
}

function withPlayoffs(label, games) {
  return games.some((game) => game.postseason) ? `${label}, incl. playoffs` : label
}

function seasonsIn(games) {
  return new Set(games.map((game) => game.season).filter((season) => season != null)).size
}

const sameOpp = (key) => (a, b) => a != null && b != null && key(a) === key(b)

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
  earlySeasonGames = DEFAULT_EARLY_SEASON_GAMES,
  logCap = null,
  recentScope = 'all',
  hideEmptyRest = false,
  oppKey = (team) => String(team).toUpperCase(),
  extraSplits = [],
} = {}) {
  const logged = Array.isArray(games) ? games : []
  const truncatedSeason = truncatedSeasonOf(logged, logCap)
  const list = withRest(playedGames(logged))
  const out = []
  const skipped = []
  const season = currentSeason ?? list[0]?.season ?? null
  const seasonGames = season == null ? list : list.filter((game) => game.season === season)
  const labels = { seasonLabel, truncatedSeason }
  const loggedIn = (value) => logged.filter((game) => game.season === value).length

  out.push(row('Sample', 'season', season == null ? 'All logged' : withPlayoffs(sampleLabel(season, loggedIn(season), labels), seasonGames), seasonGames, line, { early: seasonGames.length < earlySeasonGames }))
  if (priorSeason != null) {
    const prior = list.filter((game) => game.season === priorSeason)
    if (prior.length) out.push(row('Sample', 'prior', withPlayoffs(sampleLabel(priorSeason, loggedIn(priorSeason), labels), prior), prior, line))
  }
  if (list.some((game) => game.day != null) && today != null) {
    out.push(row('Sample', 'l30d', 'Last 30 days', list.filter((game) => game.day != null && today - game.day <= 30 && today - game.day >= 0), line))
  } else skipped.push('Last 30 days (no game dates)')

  // Context splits follow the item-1 scope.
  const pool = recentScope === 'season' ? seasonGames : list
  const tag = recentScope === 'both' && seasonsIn(pool) > 1 ? ' · both seasons' : ''
  const ctx = (name) => `${name}${tag}`

  if (pool.some((game) => game.home != null)) {
    out.push(row(ctx('Venue'), 'home', 'Home', pool.filter((game) => game.home === true), line))
    out.push(row(ctx('Venue'), 'away', 'Away', pool.filter((game) => game.home === false), line))
  } else skipped.push('Home/Away (logs have no venue)')

  if (opponent) {
    const match = sameOpp(oppKey)
    out.push(row(ctx('Opponent'), 'vsopp', `vs ${opponent}`, pool.filter((game) => match(game.opp, opponent)), line))
  } else skipped.push('vs opponent (no game today)')

  if (pool.some((game) => game.result === 'W' || game.result === 'L')) {
    out.push(row(ctx('Result'), 'wins', 'Team wins', pool.filter((game) => game.result === 'W'), line))
    out.push(row(ctx('Result'), 'losses', 'Team losses', pool.filter((game) => game.result === 'L'), line))
  } else skipped.push('Wins/Losses (logs have no result)')

  if (restApplies) {
    if (pool.some((game) => game.rest != null)) {
      const rest = [
        row(ctx('Rest'), 'rest0', '0 days rest', pool.filter((game) => game.rest === 0), line),
        row(ctx('Rest'), 'rest1', '1 day rest', pool.filter((game) => game.rest === 1), line),
        row(ctx('Rest'), 'rest2', '2+ days rest', pool.filter((game) => game.rest != null && game.rest >= 2), line),
      ]
      out.push(...(hideEmptyRest ? rest.filter((entry) => entry.n > 0) : rest))
    } else skipped.push('Rest days (no game dates)')
  }

  if (handApplies) {
    if (pool.some((game) => game.oppHand === 'L' || game.oppHand === 'R')) {
      out.push(row(ctx('Pitcher'), 'vslhp', 'vs LHP', pool.filter((game) => game.oppHand === 'L'), line))
      out.push(row(ctx('Pitcher'), 'vsrhp', 'vs RHP', pool.filter((game) => game.oppHand === 'R'), line))
    } else skipped.push('vs LHP/RHP (no starter hand in logs)')
  }
  // Sport-specific splits ({ group, id, label, test(game), ownScope }); a
  // split with no matching games is left out. They follow the context scope
  // unless the split picks its own games (ownScope: its test already limits
  // the season, so it reads every played game and gets no scope tag).
  ;(Array.isArray(extraSplits) ? extraSplits : []).forEach((split) => {
    const source = split.ownScope ? list : pool
    const matched = source.filter((game) => split.test(game))
    if (matched.length) out.push(row(split.ownScope ? split.group : ctx(split.group), split.id, split.label, matched, line))
  })
  return { rows: out, skipped, seasonGames: seasonGames.length }
}

// One advanced metric over a set of games. `metric.total(games)` returns the
// aggregate (a rate from summed parts, or a per-game average); `metric.game`
// returns the per-game value for the mini chart.
//
// windowFrom 'logged' (basketball) takes the newest N logged rows and then
// drops 0-minute games, exactly like the Minutes & Usage card, so L5 Minutes
// here and there agree. Otherwise L5 is the newest five games with a value.
export function metricWindows(metric, games, {
  currentSeason = null,
  priorSeason = null,
  seasonLabel = (s) => String(s ?? ''),
  logCap = null,
  recentScope = 'all',
  windowFrom = 'usable',
} = {}) {
  const logged = Array.isArray(games) ? games : []
  const truncatedSeason = truncatedSeasonOf(logged, logCap)
  const keep = (list) => playedGames(list).filter((game) => (metric.has ? metric.has(game.raw) : true))
  const season = currentSeason ?? logged[0]?.season ?? null
  const inSeason = (value) => (game) => game.season === value
  const source = recentScope === 'season' && season != null ? logged.filter(inSeason(season)) : logged
  const take = (count) => (windowFrom === 'logged' ? keep(source.slice(0, count)) : keep(source).slice(0, count))
  const windowLabel = (value) => {
    const name = seasonLabel(value)
    return truncatedSeason != null && value === truncatedSeason ? `Last ${logged.filter(inSeason(value)).length} of ${name}` : name
  }
  const recentLabel = (label, list) => (recentScope === 'both' && seasonsIn(list) > 1 ? `${label} · both seasons` : label)
  const windows = []
  const hideRecent = recentScope === 'season' && playedGames(source).length < SCOPED_MIN_GAMES
  if (!hideRecent) {
    const l5 = take(5)
    const l10 = take(10)
    windows.push({ id: 'l5', label: recentLabel('L5', l5), games: l5 }, { id: 'l10', label: recentLabel('L10', l10), games: l10 })
  }
  windows.push({ id: 'season', label: season == null ? 'Season' : windowLabel(season), games: season == null ? keep(logged) : keep(logged.filter(inSeason(season))) })
  if (priorSeason != null) windows.push({ id: 'prior', label: windowLabel(priorSeason), games: keep(logged.filter(inSeason(priorSeason))) })
  return windows.map((window) => {
    const raws = window.games.map((game) => game.raw)
    const value = raws.length ? finite(metric.total(raws)) : null
    return {
      id: window.id,
      label: window.label,
      n: raws.length,
      value,
      small: raws.length > 0 && raws.length < SMALL_SAMPLE,
      playoffs: window.games.some((game) => game.postseason),
    }
  })
}

export function metricSeries(metric, games, count = 10) {
  const list = playedGames(games).filter((game) => (metric.has ? metric.has(game.raw) : true)).slice(0, count)
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

// Bar-chart labels for the last-10 strip. Ten bars are ~21px wide on a 320px
// phone, so dates show the day of the month only (the caption carries the
// M/D range) and values use a short form: one decimal under 10, whole numbers
// from 10 up. AVG-style values keep three digits; the strip turns those
// labels sideways (see seriesLabelsVertical).
export function seriesDayLabels(days) {
  return (days || []).map((day) => (day == null ? '' : String(new Date(day * DAY_MS).getUTCDate())))
}

export function seriesRange(days) {
  const known = (days || []).filter((day) => day != null)
  if (!known.length) return ''
  const first = dayLabel(known[0])
  const last = dayLabel(known[known.length - 1])
  return first === last ? first : `${first}–${last}`
}

const SERIES_FORMAT = { pct: 'pctInt', pct100: 'int' }

export function seriesValueLabel(value, format) {
  const number = finite(value)
  if (number == null) return '—'
  const short = SERIES_FORMAT[format] || format
  if (short === 'one' || short === 'two') return Math.abs(number) >= 10 ? String(Math.round(number)) : number.toFixed(1)
  return formatMetric(number, short)
}

export function seriesLabelsVertical(labels) {
  return (labels || []).some((label) => String(label).length > 3)
}

export function dayLabel(day) {
  if (day == null) return ''
  const date = new Date(day * DAY_MS)
  return `${date.getUTCMonth() + 1}/${date.getUTCDate()}`
}

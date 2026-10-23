// Over-hit rates for the prop-board color strip.
//
// Every sport uses the same rule. A game over the line is a hit. A game under
// the line is a miss. A push (the result equals the line) is neither, so it
// leaves both the numerator and the denominator. The count under a pill is
// decided games only.
//
// A fixed window (L5, L10, L20) is hidden when the log is shorter than that
// window. The NHL chart already prints the game count on a short window, so
// those pills stay and carry that count. Season and H2H have no fixed length:
// they show whenever at least one decided game exists.

export const HIT_RATE_GREEN = '#22c55e'
export const HIT_RATE_LIGHT = '#4ade80'
export const HIT_RATE_AMBER = '#f6c35f'
export const HIT_RATE_RED = '#f87171'

const WINDOWS = [
  { id: 'l5', label: 'L5', size: 5 },
  { id: 'l10', label: 'L10', size: 10 },
  { id: 'l20', label: 'L20', size: 20 },
]

// Same stat map as KboPlayerPage. Missing box-score fields count as 0.
export const KBO_VALUE = {
  'Hits+Runs+RBIs': (game) => game.hrr ?? 0,
  'Total Bases': (game) => game.tb ?? 0,
  'Hitter Fantasy Score': (game) => game.fs ?? 0,
  'Pitcher Strikeouts': (game) => game.so ?? 0,
  'Pitching Outs': (game) => game.outs ?? 0,
  'Hits Allowed': (game) => game.ha ?? 0,
  'Pitcher Hits Allowed': (game) => game.ha ?? 0,
}

// Same stat map as the WNBA player page and L10 hit-rate chart.
const WNBA_VALUE = {
  Points: (game) => game.pts ?? 0,
  Rebounds: (game) => game.reb ?? 0,
  Assists: (game) => game.ast ?? 0,
  'FG Made': (game) => game.fgm ?? 0,
  'FG Attempted': (game) => game.fga ?? 0,
  'Two Pointers Made': (game) => game.fg2m ?? 0,
  'Two Pointers Attempted': (game) => game.fg2a ?? 0,
  '3-PT Made': (game) => game.fg3m ?? 0,
  '3-PT Attempted': (game) => game.fg3a ?? 0,
  'Free Throws Made': (game) => game.ftm ?? 0,
  'Free Throws Attempted': (game) => game.fta ?? 0,
  Steals: (game) => game.stl ?? 0,
  Blocks: (game) => game.blk ?? 0,
  'Blocked Shots': (game) => game.blk ?? 0,
  'Blks+Stls': (game) => (game.blk ?? 0) + (game.stl ?? 0),
  Turnovers: (game) => game.tov ?? 0,
  'Offensive Rebounds': (game) => game.oreb ?? 0,
  'Defensive Rebounds': (game) => game.dreb ?? 0,
  'Fantasy Score': (game) => game.fantasy ?? 0,
  'Reb+Asts': (game) => (game.reb ?? 0) + (game.ast ?? 0),
  'Rebs+Asts': (game) => (game.reb ?? 0) + (game.ast ?? 0),
  'Pts+Rebs': (game) => (game.pts ?? 0) + (game.reb ?? 0),
  'Pts+Asts': (game) => (game.pts ?? 0) + (game.ast ?? 0),
  'Pts+Rebs+Asts': (game) => (game.pts ?? 0) + (game.reb ?? 0) + (game.ast ?? 0),
  'Double-Double': (game) => [game.pts, game.reb, game.ast, game.stl, game.blk].filter((value) => (value ?? 0) >= 10).length >= 2 ? 1 : 0,
  'Triple-Double': (game) => [game.pts, game.reb, game.ast, game.stl, game.blk].filter((value) => (value ?? 0) >= 10).length >= 3 ? 1 : 0,
}

export function wnbaLoggedValues(games, stat) {
  const getValue = WNBA_VALUE[stat]
  if (!getValue) return []
  return (games || []).map((game) => getValue(game))
}

export function kboLoggedValues(games, stat) {
  const getValue = KBO_VALUE[stat]
  if (!getValue) return []
  return (games || []).map((game) => getValue(game))
}

function numericRate(rate) {
  if (typeof rate === 'boolean' || rate == null || rate === '') return null
  const value = Number(rate)
  return Number.isFinite(value) ? value : null
}

export function hitRatePillColor(rate) {
  const value = numericRate(rate)
  if (value == null) return null
  if (value >= 70) return HIT_RATE_GREEN
  if (value >= 55) return HIT_RATE_LIGHT
  if (value >= 45) return HIT_RATE_AMBER
  return HIT_RATE_RED
}

export const HIT_RATE_NEUTRAL_BG = '#3f3f46'
export const HIT_RATE_NEUTRAL_TEXT = '#a1a1aa'

export function hitRateFill(hex, alpha) {
  const int = Number.parseInt(String(hex).slice(1), 16)
  const red = (int >> 16) & 255
  const green = (int >> 8) & 255
  const blue = int & 255
  return `rgba(${red}, ${green}, ${blue}, ${alpha})`
}

// Tinted pill. Fewer than 3 games stays neutral so a tiny sample is not a green or red signal.
export function hitRatePillStyle(pill) {
  const games = Number(pill?.games)
  if (Number.isFinite(games) && games < 3) {
    return {
      thin: true,
      background: HIT_RATE_NEUTRAL_BG,
      borderColor: 'rgba(161, 161, 170, 0.45)',
      color: HIT_RATE_NEUTRAL_TEXT,
    }
  }
  const color = hitRatePillColor(pill?.rate)
  if (!color) return null
  return {
    thin: false,
    background: hitRateFill(color, 0.16),
    borderColor: hitRateFill(color, 0.45),
    color,
  }
}

export function formatGameCount(games) {
  const count = Number(games)
  if (!Number.isFinite(count) || count <= 0) return ''
  return `${count} gm`
}

export function formatHitRate(rate) {
  const value = numericRate(rate)
  if (value == null) return ''
  return `${Math.round(value)}%`
}

export function pillById(pills, id) {
  return (Array.isArray(pills) ? pills : []).find((pill) => pill.id === id) || null
}

// Homepage free picks and the board pills share this. `text` is the rounded
// rate. `games` is the decided-game count, empty when the pill has none.
export function l10Display(pills) {
  const pill = pillById(pills, 'l10')
  if (!pill) return null
  const text = formatHitRate(pill.rate)
  if (!text) return null
  return {
    text,
    games: formatGameCount(pill.games),
    rate: pill.rate,
    decided: pill.games,
  }
}

// 'hit' is over the line, 'miss' is under it, 'push' ties it. Missing numbers
// are not a result.
export function lineResult(value, line) {
  if (value == null || value === '' || line == null || line === '') return null
  const actual = Number(value)
  const target = Number(line)
  if (!Number.isFinite(actual) || !Number.isFinite(target)) return null
  if (actual > target) return 'hit'
  if (actual === target) return 'push'
  return 'miss'
}

export function overHitRate(values, line) {
  const target = Number(line)
  if (!Number.isFinite(target)) return null
  let hits = 0
  let decided = 0
  for (const raw of values || []) {
    const result = lineResult(raw, target)
    if (result == null || result === 'push') continue
    decided += 1
    if (result === 'hit') hits += 1
  }
  if (!decided) return null
  return { rate: Math.round((hits / decided) * 100), hits, games: decided }
}

// Same bar the Today chart paints. A push ties the line. An under play hits
// when the result is under the line; every other side hits when it clears.
// Strings and numbers share one comparison. A missing number is not a result.
export function barResult(value, line, side) {
  const actual = Number(value)
  const target = Number(line)
  if (!Number.isFinite(actual) || !Number.isFinite(target)) return null
  if (actual === target) return 'push'
  const under = String(side || '').toUpperCase() === 'UNDER'
  return (under ? actual < target : actual > target) ? 'hit' : 'miss'
}

// Rate for the games the chart actually draws. Pushes leave both the
// numerator and the denominator. Null when nothing was decided.
export function chartWindowRate(values, line, side) {
  let hits = 0
  let decided = 0
  for (const raw of values || []) {
    const result = barResult(raw, line, side)
    if (result == null || result === 'push') continue
    decided += 1
    if (result === 'hit') hits += 1
  }
  if (!decided) return null
  return { rate: Math.round((hits / decided) * 100), hits, games: decided }
}

function finiteValues(values) {
  const out = []
  for (const raw of values || []) {
    const value = Number(raw)
    if (Number.isFinite(value)) out.push(value)
  }
  return out
}

// `values` is newest-first, one entry per logged game.
export function fixedWindowPill(values, line, { id, label, size, partial = 'hide' }) {
  const games = Array.isArray(values) ? values : []
  if (games.length < size) {
    if (partial !== 'count' || games.length === 0) return null
  }
  const sample = finiteValues(games.slice(0, size))
  const rated = overHitRate(sample, line)
  if (!rated) return null
  return {
    id,
    label,
    rate: rated.rate,
    games: rated.games,
    count: games.length < size ? rated.games : null,
  }
}

export function windowPills(values, line, options = {}) {
  return WINDOWS
    .map((window) => fixedWindowPill(values, line, { ...window, ...options }))
    .filter(Boolean)
}

export function openPill(values, line, { id, label }) {
  const rated = overHitRate(finiteValues(values), line)
  if (!rated) return null
  return { id, label, rate: rated.rate, games: rated.games, count: null }
}

// Precomputed NHL chart rates. `games` is the decided-game count from hit_rate,
// which already leaves pushes out. NFL pills are recomputed from the log.
export function storedPill({ id, label, rate, games, size = null, partial = 'hide', note = null }) {
  const value = Number(rate)
  const count = Number(games)
  if (!Number.isFinite(value) || !Number.isFinite(count) || count <= 0) return null
  const pill = { id, label, rate: value, games: count, count: null, note: note || null }
  if (size != null && count < size) {
    if (partial !== 'count') return null
    pill.count = count
  }
  return pill
}

export function calendarYear(date) {
  const text = String(date ?? '').trim()
  const iso = text.match(/^(\d{4})-\d{2}-\d{2}/)
  if (iso) return iso[1]
  const us = text.match(/(\d{4})\s*$/)
  if (us) return us[1]
  return null
}

function sameTeam(left, right) {
  const a = String(left ?? '').trim().toUpperCase()
  const b = String(right ?? '').trim().toUpperCase()
  return a !== '' && a === b
}

function valuesFor(games, getValue) {
  if (typeof getValue !== 'function') return []
  return (games || []).map((game) => getValue(game))
}

function seasonValues(games, getValue, seasonOf) {
  const rows = Array.isArray(games) ? games : []
  if (!rows.length || typeof seasonOf !== 'function') return []
  const season = seasonOf(rows[0])
  if (season == null || season === '') return []
  return valuesFor(rows.filter((game) => seasonOf(game) === season), getValue)
}

export function kboHitPills({ games, stat, line, opponent }) {
  const getValue = KBO_VALUE[stat]
  if (!getValue || line == null) return []
  const rows = Array.isArray(games) ? games : []
  const values = valuesFor(rows, getValue)
  const h2h = openPill(
    valuesFor(rows.filter((game) => sameTeam(game?.opp, opponent)), getValue),
    line,
    { id: 'h2h', label: 'H2H' },
  )
  const season = openPill(
    seasonValues(rows, getValue, (game) => (game?.season == null || game.season === '' ? null : String(game.season))),
    line,
    { id: 'season', label: 'Season' },
  )
  return [...windowPills(values, line), h2h, season].filter(Boolean)
}

export function wnbaHitPills({ games, stat, line, opponent }) {
  const getValue = WNBA_VALUE[stat]
  if (!getValue || line == null) return []
  const rows = Array.isArray(games) ? games : []
  const values = valuesFor(rows, getValue)
  const newestYear = calendarYear(rows[0]?.date)
  const h2h = openPill(
    valuesFor(rows.filter((game) => sameTeam(game?.opponent, opponent)), getValue),
    line,
    { id: 'h2h', label: 'H2H' },
  )
  const season = openPill(
    newestYear
      ? valuesFor(rows.filter((game) => calendarYear(game?.date) === newestYear), getValue)
      : [],
    line,
    { id: 'season', label: 'Season' },
  )
  return [...windowPills(values, line), h2h, season].filter(Boolean)
}

// Shipped NFL `recent` is oldest-first, the same 30-game window as the chart.
// Stored hit rates counted a push as a hit, so the pills are recomputed here.
export function nflCurrentSeason(row) {
  if (row?.priorSeasonLabel != null && row.priorSeasonLabel !== '') {
    const year = Number(row.priorSeasonLabel)
    if (Number.isFinite(year)) return year + 1
  }
  const seasons = Array.isArray(row?.gameSeasons) ? row.gameSeasons : []
  const newest = Number(seasons[seasons.length - 1])
  return Number.isFinite(newest) ? newest : null
}

export function nflHitPills(row) {
  if (!row || row.line == null) return []
  const recent = Array.isArray(row.recent) ? row.recent : []
  if (!recent.length) return []
  const newest = [...recent].reverse()
  const seasons = [...(Array.isArray(row.gameSeasons) ? row.gameSeasons : [])].reverse()
  const opponents = [...(Array.isArray(row.gameOpponents) ? row.gameOpponents : [])].reverse()
  const currentSeason = nflCurrentSeason(row)
  const h2h = newest.filter((_, index) => sameTeam(opponents[index], row.opponent))
  const season = currentSeason == null
    ? []
    : newest.filter((_, index) => Number(seasons[index]) === currentSeason)
  return [
    ...windowPills(newest, row.line),
    openPill(h2h, row.line, { id: 'h2h', label: 'H2H' }),
    openPill(season, row.line, { id: 'season', label: 'Season' }),
  ].filter(Boolean)
}

export function nhlHitPills(row) {
  if (!row) return []
  return [
    storedPill({ id: 'l5', label: 'L5', rate: row.hitRateL5, games: row.gamesL5, size: 5, partial: 'count' }),
    storedPill({ id: 'l10', label: 'L10', rate: row.hitRate, games: row.gamesL10, size: 10, partial: 'count' }),
    storedPill({ id: 'l20', label: 'L20', rate: row.hitRateL20, games: row.gamesL20, size: 20, partial: 'count' }),
    storedPill({
      id: 'h2h',
      label: 'H2H',
      rate: row.h2hHitRate,
      games: row.h2hGames,
      note: row.h2hIncludesPriorSeason ? 'includes 2025-26' : null,
    }),
    storedPill({ id: 'season', label: 'Season', rate: row.seasonHitRate, games: row.seasonGames }),
  ].filter(Boolean)
}

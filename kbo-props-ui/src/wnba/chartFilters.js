// Chart filters for the WNBA player page. Minutes always come from the game
// log (`game.min`). A blank, missing, or non-numeric value is left out rather
// than treated as zero.

export const MINUTES_STEP = 0.5

export function roundMinutes(value) {
  return Number(Number(value).toFixed(1))
}

export function recordedMinutes(game) {
  const value = game?.min
  if (typeof value === 'number') return Number.isFinite(value) ? value : null
  if (typeof value === 'string' && value.trim() !== '') {
    const parsed = Number(value)
    return Number.isFinite(parsed) ? parsed : null
  }
  return null
}

export function formatMinutes(value) {
  if (value == null || !Number.isFinite(Number(value))) return '—'
  const rounded = roundMinutes(value)
  return Number.isInteger(rounded) ? String(rounded) : rounded.toFixed(1)
}

export function clampMinutes(value, min, max, step = MINUTES_STEP) {
  if (!Number.isFinite(value)) return min
  const snapped = Math.round(value / step) * step
  const clamped = Math.min(max, Math.max(min, snapped))
  return roundMinutes(clamped)
}

export function minutesBounds(games, step = MINUTES_STEP) {
  const values = (games || []).map(recordedMinutes).filter(value => value != null)
  if (!values.length) return null
  const min = roundMinutes(Math.floor((Math.min(...values) + 1e-9) / step) * step)
  const max = roundMinutes(Math.ceil((Math.max(...values) - 1e-9) / step) * step)
  return { min, max: Math.max(min, max) }
}

// `selection` null means the handles sit on the full logged range.
export function resolveMinutesRange(bounds, selection) {
  if (!bounds) return null
  if (!selection || selection.low == null || selection.high == null) {
    return { low: bounds.min, high: bounds.max, full: true }
  }
  let low = clampMinutes(selection.low, bounds.min, bounds.max)
  let high = clampMinutes(selection.high, bounds.min, bounds.max)
  if (low > high) {
    const swap = low
    low = high
    high = swap
  }
  return {
    low,
    high,
    full: low <= bounds.min && high >= bounds.max,
  }
}

export function minutesInRange(minutes, low, high) {
  if (minutes == null || low == null || high == null) return false
  return minutes + 1e-9 >= low && minutes - 1e-9 <= high
}

// Minutes, defense rank, and usage all have to pass. Minutes are applied only
// when the log actually has them (`filterMinutes`).
export function passesChartFilters(game, {
  filterMinutes = false,
  minutesLow = null,
  minutesHigh = null,
  dvpThreshold = null,
  usageThreshold = null,
} = {}) {
  if (filterMinutes && !minutesInRange(recordedMinutes(game), minutesLow, minutesHigh)) return false
  if (dvpThreshold != null && !(game?.defRank != null && game.defRank <= dvpThreshold)) return false
  if (usageThreshold != null) {
    const usage = game?.usagePct
    if (usage == null || !Number.isFinite(Number(usage)) || Number(usage) < usageThreshold) return false
  }
  return true
}

// Same rule the player page already used: a game hits when the stat is over the line.
export function hitRateForGames(games, getValue, line) {
  if (typeof getValue !== 'function' || line == null || !Number.isFinite(Number(line))) {
    return { pct: null, hits: 0, games: 0 }
  }
  const values = (games || [])
    .map(game => getValue(game))
    .filter(value => value != null && Number.isFinite(Number(value)))
    .map(Number)
  if (!values.length) return { pct: null, hits: 0, games: 0 }
  const hits = values.filter(value => value > line).length
  return { pct: Math.round((hits / values.length) * 100), hits, games: values.length }
}

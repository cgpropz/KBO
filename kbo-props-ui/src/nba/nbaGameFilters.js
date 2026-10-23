// Minutes and usage filters for the NBA player chart. Display only: the
// filters pick which logged games the chart, the hit rate, and the
// L5/L10/L20/Season chips use. The hit-rate math itself is unchanged.
//
// Minutes come from `game.min`. Usage % comes from `game.usg`, written by the
// NBA refresh from the stored box scores. A blank or non-numeric value is left
// out of the bounds, and a game without a value drops out once that filter is
// narrowed.

export const GAME_FILTERS = [
  { id: 'min', label: 'Minutes', unit: 'min', step: 1, field: 'min' },
  { id: 'usg', label: 'Usage %', unit: '%', step: 0.5, field: 'usg' },
]

function round1(value) {
  return Number(Number(value).toFixed(1))
}

export function gameMetric(game, field) {
  const value = game?.[field]
  if (typeof value === 'number') return Number.isFinite(value) ? value : null
  if (typeof value === 'string' && value.trim() !== '') {
    const parsed = Number(value)
    return Number.isFinite(parsed) ? parsed : null
  }
  return null
}

export function snapToStep(value, min, max, step) {
  if (!Number.isFinite(value)) return min
  const snapped = Math.round(value / step) * step
  return round1(Math.min(max, Math.max(min, snapped)))
}

// Rounded outward to the step so every logged game sits inside the default.
export function metricBounds(games, field, step = 1) {
  const values = (games || []).map((game) => gameMetric(game, field)).filter((value) => value != null)
  if (!values.length) return null
  const min = round1(Math.floor((Math.min(...values) + 1e-9) / step) * step)
  const max = round1(Math.ceil((Math.max(...values) - 1e-9) / step) * step)
  return { min, max: Math.max(min, max), count: values.length }
}

// `selection` null (or missing ends) means the handles sit on the full range.
export function resolveRange(bounds, selection, step = 1) {
  if (!bounds) return null
  if (!selection || selection.low == null || selection.high == null) {
    return { low: bounds.min, high: bounds.max, full: true }
  }
  let low = snapToStep(selection.low, bounds.min, bounds.max, step)
  let high = snapToStep(selection.high, bounds.min, bounds.max, step)
  if (low > high) [low, high] = [high, low]
  return { low, high, full: low <= bounds.min && high >= bounds.max }
}

export function inRange(value, range) {
  if (!range || range.full) return true
  if (value == null) return false
  return value + 1e-9 >= range.low && value - 1e-9 <= range.high
}

// Every narrowed filter has to pass. Order is kept (newest first).
export function filterGames(games, ranges = {}) {
  const active = GAME_FILTERS.filter((filter) => ranges[filter.id] && !ranges[filter.id].full)
  if (!active.length) return games || []
  return (games || []).filter((game) => active.every((filter) => inRange(gameMetric(game, filter.field), ranges[filter.id])))
}

export function isFiltered(ranges = {}) {
  return GAME_FILTERS.some((filter) => ranges[filter.id] && !ranges[filter.id].full)
}

export function formatMetric(value, step = 1) {
  if (value == null || !Number.isFinite(Number(value))) return '—'
  const rounded = round1(value)
  return step >= 1 || Number.isInteger(rounded) ? String(Math.round(rounded * 10) / 10) : rounded.toFixed(1)
}

// "Season" is the newest season in the log. Logs written before the refresh
// tagged a season count as one season.
export function newestSeasonLogs(logs, newestSeason) {
  if (newestSeason == null || newestSeason === '') return logs
  return logs.filter((game) => game?.season == null || String(game.season) === String(newestSeason))
}

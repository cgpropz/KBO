// Strength/weakness color scale shared by every sport's Splits and Advanced
// stats. Display only: it compares numbers the page already shows and never
// feeds a model, projection, score or ranking.
//
// Registering a sport (see the PR body for the full API):
//   registerStatDirection('nhl', /goals against|save/i, { lowerIsBetter: true })
//   registerBaselineProvider('nhl', (metric, model) => ({ value, label }) | null)
// A metric object can also carry `lowerIsBetter: true` itself.

export const STRENGTH_MIN_GAMES = 3
export const STRENGTH_LEVELS = Object.freeze(['weak', 'soft', 'neutral', 'good', 'strong'])

// Bands per comparison kind. `rate` compares hit rates in percentage points;
// `ratio` compares averages and advanced metrics as a share of the baseline.
export const STRENGTH_BANDS = Object.freeze({
  rate: Object.freeze({ neutral: 5, strong: 12 }),
  ratio: Object.freeze({ neutral: 0.05, strong: 0.15 }),
})

const directions = new Map()
const baselineProviders = new Map()

function normalize(text) {
  return String(text ?? '').trim().toLowerCase()
}

// `stat` is a prop name / metric id (exact, case-insensitive) or a RegExp.
// sport '*' applies everywhere; a sport's own entry wins over '*'.
export function registerStatDirection(sport, stat, { lowerIsBetter = false } = {}) {
  const key = normalize(sport) || '*'
  if (!directions.has(key)) directions.set(key, [])
  directions.get(key).unshift({ stat, lowerIsBetter: Boolean(lowerIsBetter) })
}

function lookup(sport, stat) {
  const name = normalize(stat)
  for (const key of [normalize(sport), '*']) {
    for (const entry of directions.get(key) || []) {
      const hit = entry.stat instanceof RegExp ? entry.stat.test(String(stat ?? '')) : normalize(entry.stat) === name
      if (hit) return entry.lowerIsBetter
    }
  }
  return null
}

export function isLowerBetter(sport, stat, metric = null) {
  if (metric && typeof metric.lowerIsBetter === 'boolean') return metric.lowerIsBetter
  return lookup(sport, metric?.id ?? stat) ?? (metric ? lookup(sport, metric.label) : null) ?? false
}

// A provider returns { value, label } for a metric when our published data
// has a position/league baseline, or null to fall back to the player's season.
export function registerBaselineProvider(sport, provider) {
  if (typeof provider === 'function') baselineProviders.set(normalize(sport), provider)
  else baselineProviders.delete(normalize(sport))
}

export function baselineFor(metric, model, windows = []) {
  const provider = baselineProviders.get(normalize(model?.sport))
  const published = provider ? provider(metric, model) : null
  if (published && Number.isFinite(Number(published.value))) {
    return { value: Number(published.value), label: published.label || 'league average', source: 'published' }
  }
  const season = windows.find((window) => window.id === 'season' && window.value != null && window.n >= STRENGTH_MIN_GAMES)
  if (season) return { value: season.value, label: `own ${season.label} average`, source: 'season', windowId: 'season' }
  const fallback = windows.find((window) => window.id === 'prior' && window.value != null && window.n >= STRENGTH_MIN_GAMES)
  if (fallback) return { value: fallback.value, label: `own ${fallback.label} average`, source: 'season', windowId: 'prior' }
  return null
}

// The tone of one value against its baseline.
// Returns { level: -2..2 | null, tone, cue, label }.
//  - n under STRENGTH_MIN_GAMES (or no value/baseline): tone 'muted'.
//  - lowerIsBetter flips the direction (fewer turnovers = strong).
export function strengthTone(value, baseline, { n = Infinity, kind = 'ratio', lowerIsBetter = false, bands = STRENGTH_BANDS[kind] } = {}) {
  const v = Number(value)
  const b = Number(baseline)
  if (value == null || baseline == null || !Number.isFinite(v) || !Number.isFinite(b) || !(n >= STRENGTH_MIN_GAMES)) {
    return { level: null, tone: 'muted', cue: '', label: n < STRENGTH_MIN_GAMES ? 'too few games to rate' : 'not rated' }
  }
  let delta = kind === 'rate' ? v - b : (b === 0 ? (v === 0 ? 0 : Math.sign(v)) : (v - b) / Math.abs(b))
  if (lowerIsBetter) delta = -delta
  const size = Math.abs(delta)
  const level = size < bands.neutral ? 0 : (size < bands.strong ? 1 : 2) * Math.sign(delta)
  const tone = STRENGTH_LEVELS[level + 2]
  const cue = level > 0 ? '▲' : level < 0 ? '▼' : ''
  return { level, tone, cue, label: tone === 'neutral' ? 'about usual' : tone }
}

// Text colors picked for the dark card (#0d0d0f); all clear 4.5:1.
export const STRENGTH_COLORS = Object.freeze({
  strong: '#4ade80',
  good: '#a3e635',
  neutral: '#d4d4d8',
  soft: '#fdba74',
  weak: '#f87171',
  muted: '#a1a1aa',
})

// Defaults: stats where a smaller number is the better result.
registerStatDirection('*', /turnover|interception|\bints?\b|hits allowed|walks allowed|earned runs|runs allowed|\bera\b|whip|goals against|sacks taken|fouls|def(ensive)? rank/i, { lowerIsBetter: true })

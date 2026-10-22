// Draggable prop-line math for player hit-rate charts.
//
// The rate is the same rule as the board pills: a game over the line is a hit,
// a game under the line is a miss, and a push (actual === line) is neither, so
// it leaves both the numerator and the denominator. Callers pass the games the
// chart is already showing, after its window and filters, so the live rate
// matches the bars.

import { hitRatePillStyle, overHitRate } from './hitRateStrip.js'

export const DEFAULT_LINE_STEP = 0.5

export function cleanLine(value) {
  if (typeof value === 'boolean' || value == null || value === '') return null
  const number = Number(value)
  if (!Number.isFinite(number)) return null
  return Number(number.toFixed(2))
}

export function sameLine(left, right) {
  const a = cleanLine(left)
  const b = cleanLine(right)
  return a != null && b != null && Math.abs(a - b) < 1e-9
}

export function inferLineStep(line, explicitStep) {
  const explicit = Number(explicitStep)
  if (Number.isFinite(explicit) && explicit > 0) return explicit
  const value = cleanLine(line)
  if (value == null) return DEFAULT_LINE_STEP
  const cents = Math.round(Math.abs(value) * 100)
  if (cents % 50 === 0) return 0.5
  if (cents % 25 === 0) return 0.25
  if (cents % 10 === 0) return 0.1
  return DEFAULT_LINE_STEP
}

export function roundToStep(value, step) {
  const number = Number(value)
  const size = Number(step)
  if (!Number.isFinite(number) || !Number.isFinite(size) || size <= 0) return null
  const snapped = Math.round(number / size) * size
  const decimals = size >= 1 ? 0 : Math.min(4, Math.ceil(-Math.log10(size)) + 1)
  return Number(snapped.toFixed(decimals))
}

export function clampLine(value, min, max) {
  const number = cleanLine(value)
  if (number == null) return null
  return cleanLine(Math.min(max, Math.max(min, number)))
}

export function snapLine(value, step, min, max) {
  const snapped = roundToStep(value, step)
  if (snapped == null) return null
  return clampLine(snapped, min, max)
}

// 0 through one step above the tallest logged result, the posted line, and any
// real alt, so the handle can sit above every bar.
export function lineRange(values, step, postedLine = 0, extraLines = []) {
  const size = inferLineStep(postedLine, step)
  const peak = Math.max(
    0,
    ...[postedLine, ...(extraLines || []), ...(values || [])]
      .map((value) => Number(value))
      .filter((value) => Number.isFinite(value)),
  )
  let max = roundToStep(Math.ceil((peak + 1e-9) / size) * size, size)
  if (max == null) max = size
  if (max <= peak + 1e-9) max = roundToStep(max + size, size)
  return { min: 0, max: max ?? size, step: size }
}

function uniqueLines(values) {
  const seen = new Set()
  const lines = []
  for (const raw of values || []) {
    const line = cleanLine(raw)
    if (line == null || seen.has(line)) continue
    seen.add(line)
    lines.push(line)
  }
  return lines
}

const OFFERED_KEYS = ['altLines', 'alt_lines', 'alternateLines']

export function offeredLinesForStat(rows, stat, { statKey = 'stat', lineKeys = ['line', 'standardLine'] } = {}) {
  const found = []
  for (const row of rows || []) {
    if (stat != null && row?.[statKey] !== stat && row?.prop !== stat) continue
    for (const key of lineKeys) found.push(row?.[key])
    for (const key of OFFERED_KEYS) {
      const extra = row?.[key]
      if (Array.isArray(extra)) found.push(...extra)
    }
  }
  const lines = uniqueLines(found)
  return lines.length >= 2 ? lines.sort((a, b) => a - b) : null
}

// Real alt lines when the prop has them. Otherwise the posted line ±2 steps.
export function buildAltLines({ postedLine, step, min = 0, max = Infinity, offered = null, radius = 2 } = {}) {
  const size = inferLineStep(postedLine, step)
  const offeredLines = uniqueLines(offered).filter((line) => line >= min - 1e-9 && line <= max + 1e-9)
  if (offeredLines.length >= 2) return offeredLines.sort((a, b) => a - b)
  const center = cleanLine(postedLine)
  if (center == null) return []
  const lines = []
  for (let offset = -radius; offset <= radius; offset += 1) {
    const value = clampLine(roundToStep(center + offset * size, size), min, max)
    if (value == null || lines.some((line) => sameLine(line, value))) continue
    lines.push(value)
  }
  return lines
}

export function formatLineValue(value) {
  const line = cleanLine(value)
  if (line == null) return '—'
  return Number.isInteger(line) ? String(line) : String(line)
}

function rateFields(rated) {
  if (!rated) return { rate: null, hits: 0, games: 0, pushes: 0 }
  return { rate: rated.rate, hits: rated.hits, games: rated.games, pushes: rated.pushes || 0 }
}

export function rateTextColor(rate, games) {
  return hitRatePillStyle({ rate, games })?.color || null
}

// `values` are the filtered chart games. `override` is the dragged line, or
// null while the handle is still on the posted PrizePicks line.
export function resolveChartLine({
  postedLine,
  override = null,
  values,
  step,
  offeredLines = null,
} = {}) {
  const posted = cleanLine(postedLine)
  const finite = (values || []).map((value) => Number(value)).filter((value) => Number.isFinite(value))
  const offered = Array.isArray(offeredLines) ? offeredLines : null
  const range = lineRange(finite, inferLineStep(posted, step), posted ?? 0, offered || [])
  const raw = override == null ? posted : cleanLine(override)
  const line = raw == null ? null : clampLine(raw, range.min, range.max)
  const active = override == null && line != null
    ? snapLine(line, range.step, range.min, range.max)
    : line
  const altLines = posted == null
    ? []
    : buildAltLines({
      postedLine: posted,
      step: range.step,
      min: range.min,
      max: range.max,
      offered,
    }).map((alt) => ({ line: alt, ...rateFields(overHitRate(finite, alt)) }))
  return {
    line: active,
    postedLine: posted,
    step: range.step,
    min: range.min,
    max: range.max,
    moved: !sameLine(active, posted),
    rate: active == null ? null : overHitRate(finite, active),
    alts: altLines,
  }
}

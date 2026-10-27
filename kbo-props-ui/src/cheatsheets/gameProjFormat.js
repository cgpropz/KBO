// Display helpers for the EXAMPLE game-projection mock. Chart scale matches
// the locked draft (floor 30, span 37) so the O/U line sits on the bars.

export const CHART_FLOOR = 30
export const CHART_SPAN = 37

export function format1(value) {
  const n = Number(value)
  if (!Number.isFinite(n)) return '—'
  return n.toFixed(1)
}

export function signed1(value) {
  const n = Number(value)
  if (!Number.isFinite(n)) return '—'
  const text = n.toFixed(1)
  return n > 0 ? `+${text}` : text
}

export function moneyline(value) {
  const n = Number(value)
  if (!Number.isFinite(n)) return '—'
  const rounded = Math.round(n)
  return rounded > 0 ? `+${rounded}` : String(rounded)
}

export function formatStat(stat, value) {
  const n = Number(value)
  if (!Number.isFinite(n)) return '—'
  const label = String(stat || '')
  if (label.startsWith('EPA')) return n.toFixed(2)
  if (label.startsWith('Yards')) return String(Math.round(n))
  return Number.isInteger(n) ? String(n) : n.toFixed(1)
}

export function edgeLabel(edge) {
  const n = Number(edge)
  if (!Number.isFinite(n)) return '—'
  return `${n > 0 ? '+' : ''}${n}%`
}

export function chartPct(value) {
  const pct = ((Number(value) - CHART_FLOOR) / CHART_SPAN) * 100
  return Math.round(pct * 10) / 10
}

export function heatColor(value) {
  const n = Number(value)
  if (n >= 68) return '#4ade80'
  if (n >= 54) return '#86efac'
  if (n >= 46) return '#d4d4d8'
  if (n >= 36) return '#fca5a5'
  return '#f87171'
}

export function hitColor(rate) {
  return Number(rate) >= 60 ? '#4ade80' : '#86efac'
}

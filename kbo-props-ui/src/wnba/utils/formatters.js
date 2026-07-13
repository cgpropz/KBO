export const fmt1 = v => (typeof v === 'number' ? v.toFixed(1) : parseFloat(v || 0).toFixed(1))
export const fmt2 = v => (typeof v === 'number' ? v.toFixed(2) : parseFloat(v || 0).toFixed(2))
export const fmtInt = v => Math.round(parseFloat(v || 0))
export const fmtPct = v => `${(parseFloat(v || 0) * 100).toFixed(1)}%`

export function fmtMins(v) {
  const m = parseFloat(v || 0)
  return m > 0 ? m.toFixed(1) : '—'
}

export function fmtStat(v, decimals = 1) {
  const n = parseFloat(v || 0)
  return n > 0 ? n.toFixed(decimals) : '—'
}

export function posBadgeClass(pos) {
  const p = (pos || '').toLowerCase()
  if (p === 'guard' || p === 'g') return 'badge badge-guard'
  if (p === 'forward' || p === 'f') return 'badge badge-forward'
  if (p === 'center' || p === 'c') return 'badge badge-center'
  return 'badge badge-na'
}

export function posColor(pos) {
  const p = (pos || '').toLowerCase()
  if (p === 'guard' || p === 'g') return '#60a5fa'
  if (p === 'forward' || p === 'f') return '#4ade80'
  if (p === 'center' || p === 'c') return '#c084fc'
  return '#9ca3af'
}

export function dvpLabel(factor) {
  if (factor >= 1.05) return { label: 'Easy', color: '#22c55e' }
  if (factor >= 0.95) return { label: 'Avg', color: '#f59e0b' }
  return { label: 'Hard', color: '#ef4444' }
}

export function formatDate(dateStr) {
  if (!dateStr) return ''
  const d = new Date(dateStr)
  if (isNaN(d)) return dateStr
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
}

export const TEAM_COLORS = {
  LVA: '#C9A84C', MIN: '#236192', IND: '#C8102E', PHX: '#E56020',
  NYL: '#6ECEB2', SEA: '#2C5234', GSV: '#FFC72C', CON: '#F47321',
  DAL: '#C4D600', LAS: '#702F8A', ATL: '#418FDE', CHI: '#5D76A9',
}

export function teamColor(abbr) {
  return TEAM_COLORS[abbr] || '#FF6900'
}

// ── PrizePicks Rating helpers ─────────────────────────────────────────────────
// Formula: (projection / ppLine) * 50  →  50 = exactly on the line
export function calcRating(proj, line) {
  if (!line || line === 0 || proj == null) return null
  return parseFloat(((proj / line) * 50).toFixed(1))
}

export function ratingColor(rating) {
  if (rating == null) return '#6b7280'
  if (rating >= 57)  return '#22c55e'   // strong over
  if (rating >= 53)  return '#86efac'   // lean over
  if (rating >= 47)  return '#f59e0b'   // neutral
  if (rating >= 43)  return '#fca5a5'   // lean under
  return '#ef4444'                       // strong under
}

export function ratingLabel(rating) {
  if (rating == null) return { label: 'No Line', color: '#6b7280' }
  if (rating >= 57)  return { label: 'Strong Over',  color: '#22c55e' }
  if (rating >= 53)  return { label: 'Lean Over',    color: '#86efac' }
  if (rating >= 47)  return { label: 'Neutral',      color: '#f59e0b' }
  if (rating >= 43)  return { label: 'Lean Under',   color: '#fca5a5' }
  return                    { label: 'Strong Under', color: '#ef4444' }
}

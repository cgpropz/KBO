// Display-only label for the NBA board's existing avgMins field.
// Rounding and color happen here. The board value, the score, and the rank
// stay as published.

export function expectedMinutesPill(value) {
  if (value == null) return null
  if (typeof value === 'string' && value.trim() === '') return null
  const n = typeof value === 'number' ? value : Number(typeof value === 'string' ? value.trim() : value)
  if (!Number.isFinite(n)) return null
  const minutes = Math.round(n)
  const color = minutes >= 30 ? 'green' : minutes >= 20 ? 'yellow' : 'red'
  return { minutes, label: `${minutes} MIN`, color }
}

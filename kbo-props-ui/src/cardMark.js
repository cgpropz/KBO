// Opponent text on a member card. The player's own team is never labeled this way.
export function opponentLabel(opponent) {
  const text = String(opponent ?? '').trim()
  if (!text) return ''
  return `vs ${text}`
}

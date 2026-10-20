// Empty-state text for the landing #free-top-3 card. While the manual KBO hold
// is on (api/_kboHold.js marks the payload with kbo_hold), the KBO tab says the
// lines are not posted yet instead of "no scored standard lines".

export const KBO_HOLD_TEXT = 'Lines not posted yet'

export function kboHoldMessage(sportId, data) {
  if (sportId !== 'kbo') return null
  const hold = data && typeof data === 'object' ? data.kbo_hold : null
  if (!hold || hold.active !== true) return null
  const message = typeof hold.message === 'string' ? hold.message.trim() : ''
  return message || KBO_HOLD_TEXT
}

export function freeTopEmptyText({ sportName, settled, hold }) {
  if (hold) return `${hold}. The ${sportName} free top 3 fills in when PrizePicks posts them.`
  return settled ? `No scored standard lines in the ${sportName} free top 3 right now.` : 'Loading the board…'
}

// HIGH RISK (free NBA top 3 selection, and the hub hit-rate list). The member
// board, its ranking and the score are unchanged. The exclusion uses the ESPN
// injury tag written by nba/availability.py plus the fields the projection
// step writes on each player:
//   matched !== true                    PrizePicks name not tied to a roster player
//   projectionStatus !== 'projected'    no projection from a game log
//   gp < NBA_MIN_GAMES (10)             fewer than 10 games with minutes logged
//   avgMins missing or < NBA_MIN_AVG_MINUTES (20)   low or unknown minutes role
//   espnInjuryChecked !== true              ESPN injury report not read for this row
//   espnInjuryStatus set                    ESPN Out, Suspended, Doubtful, Questionable,
//                                       Day-To-Day or GTD
// Any one of these keeps every prop of that player out of the free top 3.

export const NBA_MIN_GAMES = 10
export const NBA_MIN_AVG_MINUTES = 20

// Tags nba/availability.py writes. Any non-empty espnInjuryStatus is treated as a
// risk (an unknown tag counts too), and a row whose report was not read
// (espnInjuryChecked !== true) fails closed.
export const NBA_RISK_INJURY_STATUSES = new Set(['out', 'suspended', 'doubtful', 'questionable', 'day-to-day', 'gtd'])

const RISK_KEYS = ['espnInjuryChecked', 'espnInjuryStatus', 'matched', 'projectionStatus', 'gp', 'avgMins']

function num(value) {
  const n = Number(value)
  return Number.isFinite(n) ? n : NaN
}

export function nbaHighRisk(player) {
  if (!player || typeof player !== 'object') return true
  if (player.espnInjuryChecked !== true) return true
  if (player.espnInjuryStatus != null && String(player.espnInjuryStatus).trim() !== '') return true
  if (player.matched !== true) return true
  if (player.projectionStatus !== 'projected') return true
  const gp = num(player.gp)
  if (!Number.isFinite(gp) || gp < NBA_MIN_GAMES) return true
  const mins = num(player.avgMins)
  if (!Number.isFinite(mins) || mins < NBA_MIN_AVG_MINUTES) return true
  return false
}

// The fields the screen reads, or null when the payload has none of them.
// A trimmed free preview omits these (the server already applied the screen).
// A full board row that has any of them is screened, and a missing check
// still fails closed inside nbaHighRisk.
export function nbaRiskInput(player) {
  if (!player || typeof player !== 'object') return null
  if (!RISK_KEYS.some((key) => Object.hasOwn(player, key))) return null
  const input = {}
  for (const key of RISK_KEYS) {
    if (Object.hasOwn(player, key)) input[key] = player[key]
  }
  return input
}

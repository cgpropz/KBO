import { chartWindowRate, kboLoggedValues, overHitRate } from './hitRateStrip.js'

// PrizePicks standard-projection break-evens. Per-leg hit rate where a lineup
// of equal, independent legs returns 1x. Source: PrizePicks help center
// payouts page, pulled Oct 11, 2026. Demons, goblins, and promos differ.
export const BREAKEVEN_AS_OF = 'Oct 11, 2026'
export const MIN_SAMPLE_GAMES = 5
export const PICK_COUNTS = [2, 3, 4, 5, 6]

export const PRIZEPICKS_LINEUPS = [
  { picks: 2, mode: 'power', payout: '3x', rate: 57.74 },
  { picks: 3, mode: 'power', payout: '6x', rate: 55.03 },
  { picks: 4, mode: 'power', payout: '10x', rate: 56.23 },
  { picks: 5, mode: 'power', payout: '20x', rate: 54.93 },
  { picks: 6, mode: 'power', payout: '37.5x', rate: 54.66 },
  { picks: 2, mode: 'flex', payout: '2x / 0.5x', rate: 61.80 },
  { picks: 3, mode: 'flex', payout: '3x / 1x', rate: 57.74 },
  { picks: 4, mode: 'flex', payout: '6x / 1.5x', rate: 55.03 },
  { picks: 5, mode: 'flex', payout: '10x / 2x / 0.4x', rate: 54.25 },
  { picks: 6, mode: 'flex', payout: '25x / 2x / 0.4x', rate: 54.21 },
]

export function breakevenFor(mode, picks) {
  return PRIZEPICKS_LINEUPS.find((row) => row.mode === mode && row.picks === Number(picks)) || null
}

export function formatBreakEvenRate(rate) {
  const value = Number(rate)
  if (!Number.isFinite(value)) return ''
  return `${value.toFixed(2)}%`
}

function ratedWindow(id, label, values, line, side) {
  const rated = side === 'under'
    ? chartWindowRate(values, line, 'UNDER')
    : overHitRate(values, line)
  if (!rated || rated.games < MIN_SAMPLE_GAMES) return null
  return { id, label, rate: rated.rate, hits: rated.hits, games: rated.games }
}

// L10 and season at `line`, graded the same way as the board pills.
// L10 stays hidden until 10 games are logged. Either window is dropped when
// fewer than 5 games were decided (a push is not a decided game).
export function kboBreakEvenWindows({ games, stat, line, side = 'over' }) {
  const rows = Array.isArray(games) ? games : []
  const values = kboLoggedValues(rows, stat)
  if (!values.length || line == null || line === '') return []
  const playSide = side === 'under' ? 'under' : 'over'
  const windows = []
  if (values.length >= 10) {
    const l10 = ratedWindow('l10', 'L10', values.slice(0, 10), line, playSide)
    if (l10) windows.push(l10)
  }
  const seasonKey = rows[0]?.season
  if (seasonKey != null && seasonKey !== '') {
    const key = String(seasonKey)
    const seasonValues = kboLoggedValues(
      rows.filter((game) => String(game?.season) === key),
      stat,
    )
    const season = ratedWindow('season', 'Season', seasonValues, line, playSide)
    if (season) windows.push(season)
  }
  return windows
}

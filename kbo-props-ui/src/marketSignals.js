// Market signals for the paid Command Center. Rows come from
// /api/data?ds=market_signals. This module does not score a prop and does
// not read a projection. The chip names the feed the signal came from.
import { sportAccess } from './entitlements.js'

export const SIGNAL_KINDS = {
  line_pulled: 'Line pulled',
  line_back: 'Line back',
  big_move: 'Big move',
}

const SOURCE_NAME = {
  prizepicks: 'PrizePicks',
  unabated: 'Unabated',
  nfl_odds: 'Odds',
}

// Unabated going inactive is "market off". PrizePicks uses the line words.
// Odds history is the open-to-close big move.
const EVENT_PHRASE = {
  'prizepicks|line_pulled': 'line pulled',
  'prizepicks|line_back': 'line back',
  'unabated|line_pulled': 'market off',
  'nfl_odds|big_move': 'big move',
}

export function formatSignalTime(iso) {
  const stamp = Date.parse(iso)
  if (!Number.isFinite(stamp)) return ''
  const clock = new Intl.DateTimeFormat('en-US', {
    hour: 'numeric',
    minute: '2-digit',
    timeZone: 'America/New_York',
  }).format(new Date(stamp))
  return `${clock} ET`
}

export function signalChipText(row) {
  const source = SOURCE_NAME[row?.source] || 'Market'
  const phrase = EVENT_PHRASE[`${row?.source}|${row?.kind}`]
    || (row?.kind === 'line_back' ? 'line back' : row?.kind === 'big_move' ? 'big move' : 'line pulled')
  const time = formatSignalTime(row?.signaled_at)
  return time ? `${source} ${phrase} ${time}` : `${source} ${phrase}`
}

// Fields the panel is allowed to render. A projection or CG Score on the
// row is dropped here so the signal list cannot change either number.
export function presentSignal(row) {
  if (!row || !SIGNAL_KINDS[row.kind]) return null
  return {
    signal_key: row.signal_key,
    sport: row.sport,
    kind: row.kind,
    source: row.source || '',
    player: row.player,
    team: row.team || '',
    game_start: row.game_start,
    signaled_at: row.signaled_at,
  }
}

export function signalsForViewer(rows, tier, now = new Date()) {
  const access = sportAccess(tier)
  const allAccess = access.kbo && access.wnba && access.nfl && access.nhl
  const instant = now.getTime()
  const out = []
  for (const row of Array.isArray(rows) ? rows : []) {
    if (!row || typeof row.player !== 'string' || !SIGNAL_KINDS[row.kind]) continue
    if (row.sport === 'nba') {
      if (!allAccess) continue
    } else if (access[row.sport] !== true) continue
    const lock = Date.parse(row.game_start)
    if (!Number.isFinite(lock) || lock <= instant) continue
    const safe = presentSignal(row)
    if (safe) out.push(safe)
  }
  return out
}

export function signalsForSport(rows, sport) {
  const sorted = (Array.isArray(rows) ? rows : [])
    .filter((row) => row && row.sport === sport && SIGNAL_KINDS[row.kind])
    .slice()
    .sort((a, b) => String(b.signaled_at).localeCompare(String(a.signaled_at)))
  // The same feed can report one player twice. A second feed stays visible.
  const seen = new Set()
  const out = []
  for (const row of sorted) {
    const key = `${row.source}|${row.kind}|${row.player}`
    if (seen.has(key)) continue
    seen.add(key)
    out.push(row)
  }
  return out
}

// Dev screenshots only. The command center renders these when
// import.meta.env.DEV and ?exampleSignals=1 are both set. Production builds
// replace DEV with false, so members never see this list.
export function exampleSignals(now = new Date()) {
  const lock = new Date(now.getTime() + 3 * 60 * 60 * 1000).toISOString()
  const at = (minutes) => new Date(now.getTime() - minutes * 60 * 1000).toISOString()
  return [
    { signal_key: 'example-pulled', sport: 'nfl', kind: 'line_pulled', source: 'prizepicks', player: 'Alex Example', team: 'CIN', game_start: lock, signaled_at: at(12) },
    { signal_key: 'example-back', sport: 'nfl', kind: 'line_back', source: 'prizepicks', player: 'Riley Example', team: 'BAL', game_start: lock, signaled_at: at(4) },
    { signal_key: 'example-off', sport: 'nfl', kind: 'line_pulled', source: 'unabated', player: 'Jordan Example', team: 'KC', game_start: lock, signaled_at: at(8) },
    { signal_key: 'example-move', sport: 'nfl', kind: 'big_move', source: 'nfl_odds', player: 'Casey Example', team: 'PHI', game_start: lock, signaled_at: at(25) },
  ]
}

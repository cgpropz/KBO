// Matchup filter for the NFL PrizePicks odds board.
// A game is the unordered team pair. The label is away @ home when the row
// carries the nflverse sides (awayTeam / homeTeam). Kickoff order uses
// PrizePicks start_time, then gameday + gametime. A game with neither side
// nor a start time stays an alphabetical "A @ B" label at the end of the list.

export const ALL_MATCHUPS = 'All matchups'

const TEAM_ALIASES = { JAC: 'JAX' }
const START_FIELDS = ['start_time', 'startTime', 'start_time_utc', 'commence_time', 'kickoff', 'kickoff_utc']
const DATE_FIELDS = ['gameday', 'gameDate', 'game_date']
const TIME_FIELDS = ['gametime', 'gameTime', 'game_time']

function text(value) {
  return String(value ?? '').trim()
}

function teamCode(value) {
  const code = text(value).toUpperCase()
  return TEAM_ALIASES[code] || code
}

function etMillis(gameday, gametime) {
  const time = /^\d{2}:\d{2}/.test(gametime || '') ? gametime.slice(0, 5) : '00:00'
  const desired = `${gameday}T${time}:00`
  let utc = Date.parse(`${desired}Z`)
  if (!Number.isFinite(utc)) return null
  const etClock = (ms) => {
    const parts = new Intl.DateTimeFormat('en-US', {
      timeZone: 'America/New_York',
      hourCycle: 'h23',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
    }).formatToParts(new Date(ms))
    const get = (type) => parts.find((part) => part.type === type)?.value
    return `${get('year')}-${get('month')}-${get('day')}T${get('hour')}:${get('minute')}:00`
  }
  for (let step = 0; step < 3; step += 1) {
    const shown = etClock(utc)
    const delta = Date.parse(`${desired}Z`) - Date.parse(`${shown}Z`)
    if (!Number.isFinite(delta) || delta === 0) break
    utc += delta
  }
  return utc
}

function firstField(item, fields) {
  if (!item || typeof item !== 'object') return ''
  for (const field of fields) {
    const value = text(item[field])
    if (value) return value
  }
  return ''
}

export function matchupKey(item) {
  const team = teamCode(item?.team)
  const opponent = teamCode(item?.opponent)
  if (!team || !opponent || team === opponent) return ''
  return [team, opponent].sort().join('@')
}

export function matchupLabel(key) {
  const [left, right] = String(key || '').split('@')
  if (!left || !right) return ''
  return `${left} @ ${right}`
}

function orientedLabel(item, key) {
  const away = teamCode(item?.awayTeam || item?.away_team)
  const home = teamCode(item?.homeTeam || item?.home_team)
  if (!away || !home) return ''
  if ([away, home].sort().join('@') !== key) return ''
  return `${away} @ ${home}`
}

function kickoffMillis(item) {
  const direct = firstField(item, START_FIELDS)
  if (direct) {
    const parsed = Date.parse(direct)
    if (Number.isFinite(parsed)) return parsed
  }
  const date = firstField(item, DATE_FIELDS)
  const time = firstField(item, TIME_FIELDS)
  if (date && time) return etMillis(date, time)
  if (date) return etMillis(date, '00:00')
  return null
}

export function listMatchups(records) {
  const games = new Map()
  for (const item of Array.isArray(records) ? records : []) {
    const key = matchupKey(item)
    if (!key) continue
    const kickoff = kickoffMillis(item)
    const oriented = orientedLabel(item, key)
    const existing = games.get(key)
    if (!existing) {
      games.set(key, { id: key, label: oriented || matchupLabel(key), kickoff, oriented: Boolean(oriented) })
      continue
    }
    if (oriented && !existing.oriented) {
      existing.label = oriented
      existing.oriented = true
    }
    if (kickoff != null && (existing.kickoff == null || kickoff < existing.kickoff)) {
      existing.kickoff = kickoff
    }
  }
  return [...games.values()]
    .sort((a, b) => {
      if (a.kickoff != null && b.kickoff != null && a.kickoff !== b.kickoff) return a.kickoff - b.kickoff
      if (a.kickoff != null && b.kickoff == null) return -1
      if (a.kickoff == null && b.kickoff != null) return 1
      return a.label.localeCompare(b.label)
    })
    .map(({ id, label, kickoff }) => ({ id, label, kickoff }))
}

export function rowMatchesMatchup(item, matchupId) {
  if (!matchupId || matchupId === ALL_MATCHUPS) return true
  return matchupKey(item) === matchupId
}

// Matchup filter for the NFL PrizePicks odds board.
// Each prop row already carries team and opponent. A game is the unordered
// pair, so DAL vs HOU and HOU vs DAL are one option. Kickoff sort uses a start
// time when the snapshot row has one; otherwise the list is alphabetical.

export const ALL_MATCHUPS = 'All matchups'

const START_FIELDS = ['start_time', 'startTime', 'start_time_utc', 'commence_time', 'kickoff', 'kickoff_utc']
const DATE_FIELDS = ['gameday', 'gameDate', 'game_date']
const TIME_FIELDS = ['gametime', 'gameTime', 'game_time']

function text(value) {
  return String(value ?? '').trim()
}

function teamCode(value) {
  return text(value).toUpperCase()
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

function kickoffMillis(item) {
  const direct = firstField(item, START_FIELDS)
  const date = firstField(item, DATE_FIELDS)
  const time = firstField(item, TIME_FIELDS)
  const raw = direct || (date && time ? `${date}T${time}` : '')
  if (!raw) return null
  const parsed = Date.parse(raw)
  return Number.isFinite(parsed) ? parsed : null
}

export function listMatchups(records) {
  const games = new Map()
  for (const item of Array.isArray(records) ? records : []) {
    const key = matchupKey(item)
    if (!key) continue
    const kickoff = kickoffMillis(item)
    const existing = games.get(key)
    if (!existing) {
      games.set(key, { id: key, label: matchupLabel(key), kickoff })
      continue
    }
    if (kickoff != null && (existing.kickoff == null || kickoff < existing.kickoff)) {
      existing.kickoff = kickoff
    }
  }
  return [...games.values()].sort((a, b) => {
    if (a.kickoff != null && b.kickoff != null && a.kickoff !== b.kickoff) return a.kickoff - b.kickoff
    if (a.kickoff != null && b.kickoff == null) return -1
    if (a.kickoff == null && b.kickoff != null) return 1
    return a.label.localeCompare(b.label)
  })
}

export function rowMatchesMatchup(item, matchupId) {
  if (!matchupId || matchupId === ALL_MATCHUPS) return true
  return matchupKey(item) === matchupId
}

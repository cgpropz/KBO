// Kickoff instants for the free top 3.
// A timestamp that already carries Z or a numeric offset is that instant.
// start_time_utc and startTimeUTC with no offset are UTC (the name is the zone).
// Any other wall clock with no offset is America/New_York, not the host zone.
// A bare YYYY-MM-DD is a gameday, not a tip time. HH:MM gametime is not a tip.

const ET = 'America/New_York'
const DATE_ONLY = /^(\d{4})-(\d{2})-(\d{2})$/
const WALL = /^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})(?::(\d{2}))?(?:\.\d+)?$/
const HAS_OFFSET = /(?:Z|[+-]\d{2}:?\d{2})$/i

const TIME_KEYS = ['start', 'start_time', 'startTime', 'start_time_utc', 'kickoff_at', 'startTimeUTC']
const UTC_NAIVE_KEYS = new Set(['start_time_utc', 'startTimeUTC'])
const DAY_KEYS = ['gameday', 'game_date', 'gameDate']

function etParts(ms) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: ET,
    weekday: 'short',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(new Date(ms))
  const get = (type) => parts.find((part) => part.type === type)?.value || ''
  return {
    weekday: get('weekday'),
    year: get('year'),
    month: get('month'),
    day: get('day'),
    hour: Number(get('hour')) % 24,
    minute: get('minute'),
    second: get('second'),
  }
}

function tzOffsetMs(ms) {
  const parts = etParts(ms)
  const asUtc = Date.UTC(Number(parts.year), Number(parts.month) - 1, Number(parts.day), parts.hour, Number(parts.minute), Number(parts.second))
  return asUtc - ms
}

// Wall-clock fields are the ET clock we want. Guess UTC, then shift by the
// ET offset of that guess (and once more if the guess landed across a DST fold).
function wallToUtcMs(year, month, day, hour, minute, second) {
  const utcGuess = Date.UTC(year, month - 1, day, hour, minute, second)
  const offset = tzOffsetMs(utcGuess)
  let instant = utcGuess - offset
  const offset2 = tzOffsetMs(instant)
  if (offset2 !== offset) instant = utcGuess - offset2
  return instant
}

export function startMsFromText(value, { utcNaive = false } = {}) {
  const text = String(value ?? '').trim()
  if (!text || DATE_ONLY.test(text)) return null
  if (HAS_OFFSET.test(text)) {
    const ms = Date.parse(text)
    return Number.isFinite(ms) ? ms : null
  }
  const wall = text.match(WALL)
  if (wall) {
    const year = Number(wall[1])
    const month = Number(wall[2])
    const day = Number(wall[3])
    const hour = Number(wall[4])
    const minute = Number(wall[5])
    const second = Number(wall[6] || 0)
    if (utcNaive) return Date.UTC(year, month - 1, day, hour, minute, second)
    return wallToUtcMs(year, month, day, hour, minute, second)
  }
  const ms = Date.parse(text)
  return Number.isFinite(ms) ? ms : null
}

export function etDateKeyFromMs(ms) {
  const parts = etParts(ms)
  return `${parts.year}-${parts.month}-${parts.day}`
}

export function etTodayKey(now) {
  const ms = now instanceof Date ? now.getTime() : Number(now)
  return etDateKeyFromMs(ms)
}

export function rowStartMs(row) {
  if (!row || typeof row !== 'object') return null
  for (const key of TIME_KEYS) {
    const ms = startMsFromText(row[key], { utcNaive: UTC_NAIVE_KEYS.has(key) })
    if (ms != null) return ms
  }
  return null
}

function rowDayKey(row) {
  if (!row || typeof row !== 'object') return null
  for (const key of DAY_KEYS) {
    const text = String(row[key] ?? '').trim()
    if (DATE_ONLY.test(text)) return text
  }
  for (const key of TIME_KEYS) {
    const text = String(row[key] ?? '').trim()
    if (DATE_ONLY.test(text)) return text
  }
  return null
}

function sourcesOf(row) {
  const sources = [row]
  if (Array.isArray(row?.startChecks)) {
    for (const source of row.startChecks) {
      if (source && typeof source === 'object') sources.push(source)
    }
  }
  return sources
}

// True when this row's game has reached kickoff in America/New_York.
// A missing tip stays eligible. A date with no clock is over only once that
// ET gameday is in the past.
export function rowStartPassed(row, now = Date.now()) {
  if (!row || typeof row !== 'object') return false
  const sources = sourcesOf(row)
  if (sources.some((source) => source?.started === true || source?.locked === true || source?.removed === true)) return true
  const clock = now instanceof Date ? now.getTime() : Number(now)
  if (!Number.isFinite(clock)) return false
  const today = etDateKeyFromMs(clock)
  let sawTime = false
  for (const source of sources) {
    const ms = rowStartMs(source)
    if (ms == null) continue
    sawTime = true
    if (ms <= clock) return true
  }
  if (sawTime) return false
  // NBA publishes `started` and no tip. A calendar date is not a kickoff,
  // so an explicit false flag keeps the row. A past timestamp above still wins.
  if (sources.some((source) => source?.started === false)) return false
  for (const source of sources) {
    const day = rowDayKey(source)
    if (day && day < today) return true
  }
  return false
}

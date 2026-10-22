// Kickoff has arrived. `now` is the clock at the moment the row is judged.
// A missing or unparseable start stays eligible: there is no kickoff that
// has passed. A wall clock with no offset is America/New_York, except
// start_time_utc / startTimeUTC, which are UTC (see etStart). An explicit
// started:false with no tip stays eligible (the NBA board has no start time).
// Shared by the API preview and the hub hit-rate list.

import { etTodayKey, startMsFromText } from './etStart.js'

const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/

function etDayKey(now) {
  const date = now instanceof Date ? now : new Date(now)
  return etTodayKey(date)
}

const STARTED_FLAGS = ['locked', 'removed']
const INSTANT_KEYS = [
  ['start_time', false],
  ['startTime', false],
  ['start_time_utc', true],
  ['startTimeUTC', true],
  ['kickoff_at', false],
]
const STARTED_TIMES = ['start_time', 'startTime', 'start_time_utc', 'startTimeUTC', 'kickoff_at', 'game_date', 'gameDate', 'gameday']

function instantFromRow(row) {
  let date = null
  for (const [key, utcNaive] of INSTANT_KEYS) {
    const raw = row?.[key]
    if (raw == null || String(raw).trim() === '') continue
    const text = String(raw).trim()
    if (DATE_ONLY.test(text)) {
      date = date || text
      continue
    }
    const ms = startMsFromText(text, { utcNaive })
    if (ms != null) return { ms }
  }
  return date ? { date } : null
}

export function gameAlreadyStarted(row, now = new Date()) {
  if (row?.started === true || row?.locked === true || row?.removed === true) return true
  const nowMs = now instanceof Date ? now.getTime() : Date.parse(String(now))
  const instant = instantFromRow(row)
  if (instant?.ms != null && Number.isFinite(nowMs)) return instant.ms <= nowMs
  // NBA: `started: false` and no tip. A gameDate is not a kickoff.
  if (row?.started === false) return false
  if (instant?.date) return instant.date < etDayKey(now)
  const day = row?.game_date || row?.gameDate || row?.gameday
  if (typeof day === 'string' && DATE_ONLY.test(day)) return day < etDayKey(now)
  return false
}

// True only when the row carries a parseable start instant that is at or
// before now. Unlike gameAlreadyStarted, no flag and no date-only gameday
// counts: a row with a missing or unparseable start time is kept. Used by
// the per-request member board filter (api/_dataAccess.js).
export function startTimePassed(row, now = new Date()) {
  const nowMs = now instanceof Date ? now.getTime() : Date.parse(String(now))
  const instant = instantFromRow(row)
  return instant?.ms != null && Number.isFinite(nowMs) && instant.ms <= nowMs
}

// The fields gameAlreadyStarted reads, copied off a player or prop so the
// hub can call that function without keeping the whole source row.
export function gameStartFields(source) {
  if (!source || typeof source !== 'object') return {}
  const out = {}
  if (typeof source.started === 'boolean') out.started = source.started
  for (const key of STARTED_FLAGS) {
    if (source[key] === true) out[key] = true
  }
  for (const key of STARTED_TIMES) {
    if (source[key] != null && String(source[key]).trim() !== '') out[key] = source[key]
  }
  return out
}

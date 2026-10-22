// Kickoff has arrived. `now` is the clock at the moment the row is judged.
// A missing or unparseable start stays eligible: there is no kickoff that
// has passed. A wall clock with no offset is America/New_York (see etStart).
// Shared by the API preview and the hub hit-rate list.

import { etTodayKey, startMsFromText } from './etStart.js'

const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/

function etDayKey(now) {
  const date = now instanceof Date ? now : new Date(now)
  return etTodayKey(date)
}

const STARTED_FLAGS = ['started', 'locked', 'removed']
const STARTED_TIMES = ['start_time', 'startTime', 'start_time_utc', 'kickoff_at', 'game_date', 'gameDate', 'gameday']

export function gameAlreadyStarted(row, now = new Date()) {
  if (row?.started === true || row?.locked === true || row?.removed === true) return true
  const raw = row?.start_time ?? row?.startTime ?? row?.start_time_utc ?? row?.kickoff_at
  if (raw != null && String(raw).trim() !== '') {
    const text = String(raw).trim()
    const nowMs = now instanceof Date ? now.getTime() : Date.parse(String(now))
    if (DATE_ONLY.test(text)) return text < etDayKey(now)
    const kick = startMsFromText(text)
    if (kick != null && Number.isFinite(nowMs)) return kick <= nowMs
  }
  const day = row?.game_date || row?.gameDate || row?.gameday
  if (typeof day === 'string' && DATE_ONLY.test(day)) return day < etDayKey(now)
  return false
}

// The fields gameAlreadyStarted reads, copied off a player or prop so the
// hub can call that function without keeping the whole source row.
export function gameStartFields(source) {
  if (!source || typeof source !== 'object') return {}
  const out = {}
  for (const key of STARTED_FLAGS) {
    if (source[key] === true) out[key] = true
  }
  for (const key of STARTED_TIMES) {
    if (source[key] != null && String(source[key]).trim() !== '') out[key] = source[key]
  }
  return out
}

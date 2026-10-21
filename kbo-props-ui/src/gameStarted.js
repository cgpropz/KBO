// Kickoff has arrived. `now` is the clock at the moment the row is judged.
// A missing or unparseable start stays eligible: there is no kickoff that
// has passed. Shared by the API preview and the hub hit-rate list.

function etDayKey(now) {
  const date = now instanceof Date ? now : new Date(now)
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/New_York',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(date)
}

const STARTED_FLAGS = ['started', 'locked', 'removed']
const STARTED_TIMES = ['start_time', 'startTime', 'start_time_utc', 'kickoff_at', 'game_date', 'gameDate', 'gameday']

export function gameAlreadyStarted(row, now = new Date()) {
  if (row?.started === true || row?.locked === true || row?.removed === true) return true
  const raw = row?.start_time ?? row?.startTime ?? row?.start_time_utc ?? row?.kickoff_at
  if (raw != null && String(raw).trim() !== '') {
    const kick = Date.parse(String(raw))
    const nowMs = now instanceof Date ? now.getTime() : Date.parse(String(now))
    if (Number.isFinite(kick) && Number.isFinite(nowMs)) return kick <= nowMs
  }
  const day = row?.game_date || row?.gameDate || row?.gameday
  if (typeof day === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(day)) return day < etDayKey(now)
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

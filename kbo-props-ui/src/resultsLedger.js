// Shapes the Board QA ledger snapshot for /results.
// Rows are the latest standard snapshot posted before the game started. A pulled line is Void.
// Voids stay on the list and stay out of n. Pushes stay in W-L-P and out of the hit rate.

export const BREAK_EVEN_PCT = 54.2
export const SMALL_SAMPLE_N = 200
export const SPORT_ORDER = ['nfl', 'kbo', 'wnba', 'nhl', 'nba']
export const SPORT_NAME = { nfl: 'NFL', kbo: 'KBO', wnba: 'WNBA', nhl: 'NHL', nba: 'NBA' }

const RESULT_NAME = { H: 'HIT', M: 'MISS', P: 'PUSH', V: 'VOID' }

export function emptyRecord() {
  return { hits: 0, misses: 0, pushes: 0, voids: 0 }
}

export function addGrade(record, result) {
  if (result === 'H') record.hits += 1
  else if (result === 'M') record.misses += 1
  else if (result === 'P') record.pushes += 1
  else if (result === 'V') record.voids += 1
  return record
}

export function finishRecord(record) {
  const hits = record.hits || 0
  const misses = record.misses || 0
  const pushes = record.pushes || 0
  const voids = record.voids || 0
  const decided = hits + misses
  const n = hits + misses + pushes
  return {
    hits,
    misses,
    pushes,
    voids,
    n,
    rate: decided ? hits / decided : null,
    small: n > 0 && n < SMALL_SAMPLE_N,
  }
}

export function formatWlp(record) {
  return `${record.hits}-${record.misses}-${record.pushes}`
}

export function formatHitRate(rate) {
  if (rate == null || !Number.isFinite(rate)) return '—'
  const truncated = Math.floor(rate * 1000 + 1e-9) / 10
  return `${truncated.toFixed(1)}%`
}

export function resultLabel(code) {
  return RESULT_NAME[code] || 'VOID'
}

export function tierLabel(tier) {
  return tier === 'f' ? 'Free top 3' : 'Member'
}

export function combineRecords(records) {
  const total = emptyRecord()
  for (const record of records) {
    total.hits += record.hits || 0
    total.misses += record.misses || 0
    total.pushes += record.pushes || 0
    total.voids += record.voids || 0
  }
  return finishRecord(total)
}

export function rangeLabel(start, end) {
  if (!start || !end) return '—'
  const fmt = (iso) => {
    const date = new Date(`${iso.slice(0, 10)}T12:00:00Z`)
    return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' })
  }
  const a = fmt(start)
  const b = fmt(end)
  return a === b ? a : `${a} – ${b}`
}

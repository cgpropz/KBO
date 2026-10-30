// Shapes public.qa_pick_ledger for /results.
// Latest standard row posted before the scheduled start (snapshot_at < start_time).
// A later demon or goblin snapshot does not replace a standard line.
// Ungraded rows (no graded_at, or a result other than Hit, Miss, Push, Void)
// are left out of the table, the totals, and the date range. Only a graded
// Void counts as VOID. Voids stay on the list and stay out of n. Pushes stay
// in W-L-P and out of the hit rate.

import { oddsKey } from './playableRecord.js'

export const BREAK_EVEN_PCT = 54.2
export const SMALL_SAMPLE_N = 200
export const HISTORY_PER_SPORT = 24
export const SPORT_ORDER = ['nfl', 'kbo', 'wnba', 'nhl', 'nba']
export const SPORT_NAME = { nfl: 'NFL', kbo: 'KBO', wnba: 'WNBA', nhl: 'NHL', nba: 'NBA' }

const RESULT_NAME = { H: 'HIT', M: 'MISS', P: 'PUSH', V: 'VOID' }
const RESULT_CODE = { hit: 'H', miss: 'M', push: 'P', void: 'V' }

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
  return RESULT_NAME[code] || ''
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

export function gradeCode(row) {
  if (row?.graded_at == null || row.graded_at === '') return null
  const name = String(row.result ?? '').trim().toLowerCase()
  return RESULT_CODE[name] || null
}

function timeMs(value) {
  if (value == null || value === '') return null
  const t = Date.parse(value)
  return Number.isFinite(t) ? t : null
}

function slateDay(row) {
  return String(row?.slate_date || '').slice(0, 10)
}

function lineKey(line) {
  const n = Number(line)
  return Number.isFinite(n) ? String(n) : String(line ?? '')
}

function pickKey(row) {
  const sport = String(row?.sport || '').toLowerCase()
  return `${sport}\0${slateDay(row)}\0${row?.player}\0${row?.prop}\0${lineKey(row?.line)}\0${oddsKey(row)}`
}

function propKey(row) {
  const sport = String(row?.sport || '').toLowerCase()
  return `${sport}\0${slateDay(row)}\0${row?.player}\0${row?.prop}`
}

function newer(row, prev) {
  const snap = timeMs(row.snapshot_at)
  const prevSnap = timeMs(prev.snapshot_at)
  if (snap !== prevSnap) return (snap ?? -1) > (prevSnap ?? -1)
  return Number(row.id || 0) > Number(prev.id || 0)
}

// Graded standard rows only. Ungraded rows never become VOID.
export function selectResultsRows(rows) {
  const latest = new Map()
  for (const row of rows || []) {
    const snap = timeMs(row?.snapshot_at)
    const start = timeMs(row?.start_time)
    if (snap == null || start == null || snap >= start) continue
    const key = pickKey(row)
    const prev = latest.get(key)
    if (!prev || newer(row, prev)) latest.set(key, row)
  }

  const standard = [...latest.values()].filter((row) => oddsKey(row) === 'standard')
  const maxSnap = new Map()
  for (const row of standard) {
    const key = propKey(row)
    const snap = timeMs(row.snapshot_at)
    const prev = maxSnap.get(key)
    if (prev == null || snap > prev) maxSnap.set(key, snap)
  }

  const kept = []
  for (const row of standard) {
    if (timeMs(row.snapshot_at) < maxSnap.get(propKey(row))) continue
    const code = gradeCode(row)
    if (!code) continue
    kept.push(row)
  }
  return kept
}

export function etDay(date = new Date()) {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(date)
}

function shiftDay(iso, days) {
  const date = new Date(`${String(iso).slice(0, 10)}T12:00:00Z`)
  date.setUTCDate(date.getUTCDate() + days)
  return date.toISOString().slice(0, 10)
}

export function postedClock(value) {
  const t = timeMs(value)
  if (t == null) return '—'
  return new Date(t).toLocaleTimeString('en-US', {
    hour: 'numeric', minute: '2-digit', timeZone: 'America/New_York',
  })
}

function emptyCounts() {
  return { hits: 0, misses: 0, pushes: 0, voids: 0, start: null, end: null }
}

function bump(bucket, row, code) {
  addGrade(bucket, code)
  const day = slateDay(row)
  if (!day) return
  if (!bucket.start || day < bucket.start) bucket.start = day
  if (!bucket.end || day > bucket.end) bucket.end = day
}

function scoreValue(value) {
  if (value == null || value === '') return null
  const n = Number(value)
  return Number.isFinite(n) ? Math.round(n * 10) / 10 : null
}

function historyRow(row) {
  const sport = String(row.sport || '').toLowerCase()
  return {
    date: slateDay(row),
    sport,
    tier: row.free_top3 === true ? 'f' : 'b',
    player: row.player || '',
    market: row.prop || '',
    line: row.line,
    side: row.side || '',
    score: scoreValue(row.cg_score),
    final: scoreValue(row.actual),
    posted: postedClock(row.snapshot_at),
    result: gradeCode(row),
  }
}

export function buildResultsModel(rows, now = new Date()) {
  const kept = selectResultsRows(rows)
  const sports = {}
  for (const sport of SPORT_ORDER) {
    sports[sport] = { free: emptyCounts(), member: emptyCounts() }
  }
  const marketMap = new Map()
  let earliest = null
  let latest = null
  let updatedMs = null

  for (const row of kept) {
    const sport = String(row.sport || '').toLowerCase()
    if (!sports[sport]) continue
    const code = gradeCode(row)
    const tier = row.free_top3 === true ? 'free' : 'member'
    bump(sports[sport][tier], row, code)
    const market = String(row.prop || '')
    if (!marketMap.has(sport)) marketMap.set(sport, new Map())
    const markets = marketMap.get(sport)
    if (!markets.has(market)) markets.set(market, { market, free: emptyCounts(), member: emptyCounts() })
    bump(markets.get(market)[tier], row, code)
    const day = slateDay(row)
    if (day && (!earliest || day < earliest)) earliest = day
    if (day && (!latest || day > latest)) latest = day
    const graded = timeMs(row.graded_at)
    if (graded != null && (updatedMs == null || graded > updatedMs)) updatedMs = graded
  }

  const markets = {}
  for (const sport of SPORT_ORDER) {
    const list = [...(marketMap.get(sport)?.values() || [])]
    list.sort((a, b) => {
      const an = a.member.hits + a.member.misses + a.member.pushes
      const bn = b.member.hits + b.member.misses + b.member.pushes
      if (an !== bn) return bn - an
      return a.market.localeCompare(b.market)
    })
    markets[sport] = list
  }

  const sorted = [...kept].sort((a, b) => {
    const day = slateDay(b).localeCompare(slateDay(a))
    if (day) return day
    return (timeMs(b.snapshot_at) || 0) - (timeMs(a.snapshot_at) || 0)
      || Number(b.id || 0) - Number(a.id || 0)
  })
  const perSport = new Map()
  for (const row of sorted) {
    const sport = String(row.sport || '').toLowerCase()
    if (!SPORT_NAME[sport]) continue
    const list = perSport.get(sport) || []
    if (list.length >= HISTORY_PER_SPORT) continue
    list.push(historyRow(row))
    perSport.set(sport, list)
  }

  const windowStart = shiftDay(etDay(now), -29)
  return {
    source: 'public.qa_pick_ledger',
    updatedAt: updatedMs == null ? null : new Date(updatedMs).toISOString(),
    earliestSlate: earliest,
    latestSlate: latest,
    seasonMatchesLast30: !earliest || earliest >= windowStart,
    historyNote: 'The table lists the newest graded rows. Totals count every graded standard row posted before the scheduled start.',
    sports,
    markets,
    history: SPORT_ORDER.flatMap((sport) => perSport.get(sport) || []),
  }
}

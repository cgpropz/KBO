// Playable record from public.qa_pick_ledger (v1). No new columns.
//
// The site reads the static snapshot in api/_playableRecord.json. It does not
// query the ledger. Board QA refreshes that file outside 6 AM–midnight ET
// with sql/playable_record.sql.
//
// 1. Latest pre-lock row per (sport, slate_date, player, prop, line, odds_type)
//    with snapshot_at < start_time. odds_type falls back to raw.line_type, then
//    "standard" (NFL stores the type on raw.line_type).
// 2. Standard rows only: drop a row whose snapshot_at is older than the latest
//    standard snapshot for (sport, slate_date, player, prop). A later demon or
//    goblin snapshot does not supersede a standard line and does not enter the
//    record. Counting those later demons as the max turns the Oct 23 NHL check
//    from 14-16 into 12-13.
// 3. Pulled at that latest row (raw.removed >= true, or raw.pp_status in
//    removed | suspended | held | hold | onhold | out | replaced | superseded)
//    is Void and stays out of the record.
// 4. Keep coalesce(odds_type, raw.line_type, "standard") = "standard" and
//    result in Hit | Miss.
//
// wins = Hit, losses = Miss, hit_pct = wins / (wins + losses).
// The label is "Playable record". Demon and goblin lines, including unders,
// never enter the numerator or the denominator.

export const PLAYABLE_RECORD_LABEL = 'Playable record'

const PULLED_STATUSES = new Set([
  'removed', 'suspended', 'held', 'hold', 'onhold', 'out', 'replaced', 'superseded',
])

function rawOf(row) {
  const raw = row?.raw
  return raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {}
}

export function oddsKey(row) {
  const direct = String(row?.odds_type ?? '').trim()
  if (direct) return direct.toLowerCase()
  const lineType = String(rawOf(row).line_type ?? '').trim()
  if (lineType) return lineType.toLowerCase()
  return 'standard'
}

// `removed >= true`: JSON true, or a number (or numeric string) at least 1.
// The string "true" does not pass a >= true comparison.
export function removedAtLeastTrue(value) {
  if (value === true) return true
  if (typeof value === 'number') return Number.isFinite(value) && value >= 1
  if (typeof value === 'string' && /^-?\d+(\.\d+)?$/.test(value.trim())) return Number(value) >= 1
  return false
}

export function isPulled(row) {
  const raw = rawOf(row)
  if (removedAtLeastTrue(raw.removed)) return true
  const status = String(raw.pp_status ?? '').toLowerCase().replace(/[^a-z]/g, '')
  return PULLED_STATUSES.has(status)
}

function timeMs(value) {
  if (value == null || value === '') return null
  const t = Date.parse(value)
  return Number.isFinite(t) ? t : null
}

function slateKey(row) {
  return `${String(row?.sport || '').toLowerCase()}\0${String(row?.slate_date || '').slice(0, 10)}`
}

function lineKey(line) {
  const n = Number(line)
  return Number.isFinite(n) ? String(n) : String(line ?? '')
}

function pickKey(row) {
  return `${slateKey(row)}\0${row?.player}\0${row?.prop}\0${lineKey(row?.line)}\0${oddsKey(row)}`
}

function propKey(row) {
  return `${slateKey(row)}\0${row?.player}\0${row?.prop}`
}

function newer(row, prev) {
  const snap = timeMs(row.snapshot_at)
  const prevSnap = timeMs(prev.snapshot_at)
  if (snap !== prevSnap) return snap > prevSnap
  return Number(row.id || 0) > Number(prev.id || 0)
}

// Rows that count: standard, pre-lock, not superseded, not pulled, Hit or Miss.
export function playablePicks(rows) {
  const latest = new Map()
  for (const row of rows || []) {
    const snap = timeMs(row?.snapshot_at)
    const lock = timeMs(row?.start_time)
    if (snap == null || lock == null || snap >= lock) continue
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
    if (isPulled(row)) continue
    if (row.result !== 'Hit' && row.result !== 'Miss') continue
    kept.push(row)
  }
  return kept
}

export function hitPct(wins, losses) {
  const decided = (Number(wins) || 0) + (Number(losses) || 0)
  if (!decided) return null
  return (Number(wins) || 0) / decided
}

// One decimal, truncated, so 14/30 renders 46.6% — the Board QA citation of
// that fraction. 46.666...% rounded half up would be 46.7%.
export function formatPlayablePct(value) {
  const n = Number(value)
  if (!Number.isFinite(n)) return null
  const truncated = Math.floor(n * 1000 + 1e-9) / 10
  return `${truncated.toFixed(1)}%`
}

export function tallyPicks(rows) {
  let wins = 0
  let losses = 0
  for (const row of rows || []) {
    if (row.result === 'Hit') wins += 1
    else if (row.result === 'Miss') losses += 1
  }
  return { wins, losses, hit_pct: hitPct(wins, losses) }
}

export function freeTop3Picks(rows) {
  return (rows || []).filter((row) => row.free_top3 === true)
}

export function slateDateLabel(iso) {
  if (!iso) return ''
  const d = new Date(`${String(iso).slice(0, 10)}T12:00:00Z`)
  if (Number.isNaN(d.getTime())) return String(iso)
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' })
}

// One slate, or the latest graded slate for a sport when slateDate is omitted.
export function playableSlate(record, { sport, slateDate } = {}) {
  const slates = Array.isArray(record?.slates) ? record.slates : []
  const sportId = String(sport || '').toLowerCase()
  let rows = slates.filter((row) => !sportId || String(row.sport || '').toLowerCase() === sportId)
  if (slateDate) return rows.find((row) => row.slate_date === slateDate) || null
  rows = rows.filter((row) => (Number(row.wins) || 0) + (Number(row.losses) || 0) > 0)
  rows.sort((a, b) => String(a.slate_date).localeCompare(String(b.slate_date)))
  return rows.at(-1) || null
}

// Sum every matching slate. Pass slateDate for one day, or omit it for the sport.
export function playableTotals(record, { sport, slateDate } = {}) {
  const slates = Array.isArray(record?.slates) ? record.slates : []
  const sportId = String(sport || '').toLowerCase()
  const rows = slates.filter((row) => {
    if (sportId && String(row.sport || '').toLowerCase() !== sportId) return false
    if (slateDate && row.slate_date !== slateDate) return false
    return true
  })
  let wins = 0
  let losses = 0
  let freeWins = 0
  let freeLosses = 0
  for (const row of rows) {
    wins += Number(row.wins) || 0
    losses += Number(row.losses) || 0
    freeWins += Number(row.free_top3?.wins) || 0
    freeLosses += Number(row.free_top3?.losses) || 0
  }
  return {
    wins,
    losses,
    hit_pct: hitPct(wins, losses),
    free_top3: { wins: freeWins, losses: freeLosses, hit_pct: hitPct(freeWins, freeLosses) },
  }
}

export function playableRecordText(slate) {
  if (!slate) return null
  const wins = Number(slate.wins) || 0
  const losses = Number(slate.losses) || 0
  if (wins + losses === 0) return null
  const pct = formatPlayablePct(slate.hit_pct ?? hitPct(wins, losses))
  const when = slateDateLabel(slate.slate_date)
  const freeWins = Number(slate.free_top3?.wins) || 0
  const freeLosses = Number(slate.free_top3?.losses) || 0
  const freeText = freeWins + freeLosses > 0 ? ` · Free top 3 ${freeWins}-${freeLosses}` : ''
  return `${PLAYABLE_RECORD_LABEL} ${when} ${wins}-${losses} (${pct})${freeText}`
}

// Shown with the record so a hit rate is never a bare percentage. Push, Void,
// and Ungraded stay out, and demon/goblin lines (including unders) never enter
// the count. This is not a result versus the sportsbook.
export const PLAYABLE_RECORD_NOTE = 'Hits and misses only. Push, Void, and Ungraded are excluded. Demon and goblin lines, including unders, are not in this count. This is not a record versus the book.'

export function playableRecordDetail(slate) {
  const line = playableRecordText(slate)
  if (!line) return null
  const wins = Number(slate.wins) || 0
  const losses = Number(slate.losses) || 0
  const n = wins + losses
  return {
    line,
    n,
    note: `${n} decided standard ${n === 1 ? 'line' : 'lines'}. ${PLAYABLE_RECORD_NOTE}`,
  }
}

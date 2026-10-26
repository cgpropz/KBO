// NBA board panel: "When this hits, these often hit too".
//
// Code Green cleared the research rule on Oct 25, 2026
// (/workspace/shared/lab/correlated_props_rule_2026-10-25.md).
// Floors, the counting-stat allowlist, and the W=20 label live here so a
// later data change can swap them in one place.
//
// Published nba_correlations rows only have agreement + n (same-side rate
// over shared decisions). This module does not compute a conditional hit
// rate, does not cap n at W=20, and does not build L10 bars from game logs.
// A-hit floors and real bars apply only when those fields are already on
// the pair. Line source is labeled only when the file says
// saved_pp_standard or current_line_retro.

import {
  HIT_TOGETHER,
  formatAgreement,
  normName,
  propKey,
} from './slipCorrelations.js'

// Same NBA pair file the slip builder loads (slipSports nba dataset).
export const NBA_CORRELATION_DATASET = 'nba_correlations'
export const NBA_CORRELATION_STATIC = 'correlations_nba.json'
export const NBA_MIN_SHARED = 15

// Cleared rule §2. Documented only — published n is not trimmed to this.
export const LOOKBACK_CAP = 20

// Cleared rule §3. Blank a row when shared decisions are below this.
export const MIN_SHARED_GAMES = 8

// Cleared rule §3. Blank a row when an A-hit count is present and below this.
export const MIN_A_HITS = 5

// Cleared rule §3. Badge when the A-hit count is in [MIN_A_HITS, this].
export const SMALL_SAMPLE_A_HITS_MAX = 7

// Cleared rule §3. List at most this many teammates (the band is 3–5).
export const MAX_PARTNERS = 5

// Cleared rule §2. Render conditional bars only at this many A-hit games.
export const MIN_BARS = 5

// Cleared rule §4, NBA counting stats. Anchor is Pts / Ast / Reb / PRA.
// Partners add FG Made and 3-PT Made. Stocks stay off the list.
export const NBA_ANCHOR_STATS = ['Points', 'Rebounds', 'Assists', 'Pts+Rebs+Asts']
export const NBA_PARTNER_STATS = ['Points', 'Rebounds', 'Assists', 'Pts+Rebs+Asts', 'FG Made', '3-PT Made']

export const CORR_TITLE = 'When this hits, these often hit too'
export const FREE_UPSELL = 'Pair rates are on All-Access.'
export const PREVIEW_UPSELL = 'Pair rates stay on the free preview.'
export const EMPTY_PAIRS = 'No teammate overs for this prop.'
export const LIMITED_PAIRS = 'Counting stats only.'
export const UNAVAILABLE_PAIRS = 'Pair history isn’t available right now.'
export const LOADING_PAIRS = 'Loading pair history…'

const A_HIT_KEYS = ['nAHits', 'aHits', 'n_a_hits']
const BAR_KEYS = ['l10', 'conditionalBars', 'aHitBars']
const LINE_SOURCE_CODES = new Set(['saved_pp_standard', 'current_line_retro'])

export function boardAnchor(row) {
  if (!row) return null
  const name = String(row.player || row.name || '').trim()
  const stat = String(row.prop || row.stat || '').trim()
  if (!name || !stat) return null
  return {
    id: row.id ?? null,
    name,
    stat,
    team: row.team || '',
    opponent: row.opponent || '',
    side: row.side || null,
  }
}

// Slip legs use name + prop. Same shape as a board anchor so a later slip
// mount can call the panel without a new pair model.
export function slipLegAnchor(leg) {
  if (!leg) return null
  return boardAnchor({
    id: leg.idx != null ? `slip-${leg.idx}` : leg.id,
    name: leg.name,
    prop: leg.prop,
    team: leg.team,
    opponent: leg.opponent,
    side: leg.side,
  })
}

export function focusBoardProp(row, { propTab, side } = {}) {
  const patch = {}
  if (row?.prop && propTab && propTab !== 'All Props' && row.prop !== propTab) patch.propTab = 'All Props'
  if (side === 'Overs' && row?.side !== 'OVER') patch.side = 'All'
  if (side === 'Unders' && row?.side !== 'UNDER') patch.side = 'All'
  return patch
}

function clubKey(value) {
  return normName(String(value || '').replace(/^(vs\.?|@)\s*/i, ''))
}

function sameClub(left, right) {
  const a = clubKey(left)
  const b = clubKey(right)
  return !!a && a === b
}

function sameGame(anchor, row) {
  const team = row.team || row._player?.team || ''
  return sameClub(anchor.team, team) && sameClub(anchor.opponent, row.opponent)
}

function isPromo(row) {
  return row?.oddsType === 'demon' || row?.oddsType === 'goblin'
}

function preferRow(current, next) {
  if (!current) return next
  if (isPromo(current) && !isPromo(next)) return next
  return current
}

function unitRate(value) {
  const n = Number(value)
  if (!Number.isFinite(n) || n < 0 || n > 1) return null
  return n
}

function readAHits(pair) {
  for (const key of A_HIT_KEYS) {
    if (pair?.[key] == null || pair[key] === '') continue
    const n = Number(pair[key])
    if (Number.isFinite(n)) return n
  }
  return null
}

function lineSourceCode(value) {
  return LINE_SOURCE_CODES.has(value) ? value : null
}

function readLineSource(pair, doc) {
  return lineSourceCode(pair?.lineSource)
    || lineSourceCode(pair?.line_source)
    || lineSourceCode(doc?.lineSource)
    || lineSourceCode(doc?.line_source)
    || null
}

function barToken(item) {
  if (item === true || item === 1) return 'hit'
  if (item === false || item === 0) return 'miss'
  if (typeof item === 'string') {
    const text = item.trim().toLowerCase()
    if (text === 'h' || text === 'hit') return 'hit'
    if (text === 'm' || text === 'miss') return 'miss'
  }
  if (item && typeof item === 'object' && typeof item.hit === 'boolean') return item.hit ? 'hit' : 'miss'
  return null
}

function readBars(pair) {
  let raw = null
  for (const key of BAR_KEYS) {
    if (pair?.[key] == null || pair[key] === '') continue
    raw = pair[key]
    break
  }
  if (raw == null) return { barsMode: 'stub', bars: null }
  const list = Array.isArray(raw) ? raw : (typeof raw === 'string' ? [...raw.trim()] : null)
  if (!list || !list.length) return { barsMode: 'stub', bars: null }
  const bars = []
  for (const item of list) {
    const token = barToken(item)
    if (!token) return { barsMode: 'stub', bars: null }
    bars.push(token)
  }
  // Published order is oldest → newest. Keep the latest MIN window, do not reverse.
  const recent = bars.slice(-10)
  if (recent.length < MIN_BARS) return { barsMode: 'short', bars: null }
  return { barsMode: 'real', bars: recent }
}

function displayedRate(pair) {
  const conditional = unitRate(pair?.conditionalHitRate ?? pair?.conditional_hit_rate)
  if (conditional != null) return { rate: conditional, kind: 'conditional' }
  const agreement = unitRate(pair?.agreement)
  if (agreement == null) return null
  return { rate: agreement, kind: 'agreement' }
}

function boardIndex(rows) {
  const map = new Map()
  for (const row of rows || []) {
    const name = row?.player || row?.name
    const stat = row?.prop || row?.stat
    const key = propKey(name, stat)
    if (!key || key === '|') continue
    map.set(key, preferRow(map.get(key), row))
  }
  return map
}

function partnerSide(pair, anchorKey) {
  const left = propKey(pair.player, pair.stat)
  const right = propKey(pair.partner, pair.partnerStat)
  if (left === anchorKey) return { name: pair.partner, stat: pair.partnerStat }
  if (right === anchorKey) return { name: pair.player, stat: pair.stat }
  return null
}

// Entitled members only. Free and preview snapshots get a one-line upsell,
// never agreement, n, or partner rows.
export function correlatedPanelModel({
  anchor,
  board,
  doc,
  entitled = false,
  loading = false,
  memberPreview = false,
  anchorStats = NBA_ANCHOR_STATS,
  partnerStats = NBA_PARTNER_STATS,
} = {}) {
  if (!anchor) return null
  const title = CORR_TITLE
  if (loading) {
    return { title, status: 'loading', showNumbers: false, message: LOADING_PAIRS, rows: [] }
  }
  if (!entitled) {
    return {
      title,
      status: 'locked',
      showNumbers: false,
      message: memberPreview ? PREVIEW_UPSELL : FREE_UPSELL,
      showPlans: !memberPreview,
      rows: [],
    }
  }
  if (!doc || doc.unavailable === true || !Array.isArray(doc.pairs)) {
    return { title, status: 'unavailable', showNumbers: false, message: UNAVAILABLE_PAIRS, rows: [] }
  }
  const allowedAnchor = new Set(anchorStats)
  if (!allowedAnchor.has(anchor.stat)) {
    return { title, status: 'limited', showNumbers: false, message: LIMITED_PAIRS, rows: [] }
  }

  const anchorKey = propKey(anchor.name, anchor.stat)
  const allowedPartner = new Set(partnerStats)
  const byKey = boardIndex(board)
  const best = new Map()
  for (const pair of doc.pairs) {
    const other = partnerSide(pair, anchorKey)
    if (!other) continue
    if (normName(other.name) === normName(anchor.name)) continue
    if (!allowedPartner.has(other.stat)) continue
    const shown = displayedRate(pair)
    if (!shown) continue
    // Existing slip cutoff. Conditional rates, once published, skip it.
    if (shown.kind === 'agreement' && !(shown.rate > HIT_TOGETHER)) continue
    const sample = Number(pair.n)
    if (!Number.isFinite(sample) || sample < MIN_SHARED_GAMES) continue
    const aHits = readAHits(pair)
    if (aHits != null && aHits < MIN_A_HITS) continue
    const row = byKey.get(propKey(other.name, other.stat))
    if (!row || row.side !== 'OVER') continue
    if (!sameGame(anchor, row)) continue
    const key = propKey(other.name, other.stat)
    const bars = readBars(pair)
    const item = {
      id: row.id,
      name: row.player || row.name,
      team: row.team || '',
      stat: row.prop || row.stat,
      rateLabel: formatAgreement(shown.rate),
      n: sample,
      smallSample: aHits != null && aHits <= SMALL_SAMPLE_A_HITS_MAX,
      barsMode: bars.barsMode,
      bars: bars.bars,
      lineSource: readLineSource(pair, doc),
      kind: shown.kind,
    }
    const prev = best.get(key)
    const better = !prev || shown.rate > prev._rate || (shown.rate === prev._rate && sample > prev.n)
    if (better) best.set(key, { ...item, _rate: shown.rate })
  }

  const rows = [...best.values()]
    .sort((a, b) => b._rate - a._rate || b.n - a.n || String(a.name).localeCompare(String(b.name)))
    .slice(0, MAX_PARTNERS)
    .map(({ _rate, ...row }) => row)

  if (!rows.length) {
    return { title, status: 'empty', showNumbers: false, message: EMPTY_PAIRS, rows: [] }
  }

  return { title, status: 'ready', showNumbers: true, message: '', rows }
}

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

import { STANDARD_LINE } from './responsibleGambling.js'
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
export const CORR_BANNER = 'Research draft — not final metrics. Published pair agreement stands in until the conditional hit rate is in the data.'
export const SCOPE_NOTE = 'Same team, same game, overs only. Counting stats: points, rebounds, assists, and PRA, plus a teammate’s field goals or threes.'
export const OVERS_NOTE = 'This prop is an under. The list stays overs only.'
export const PP_NOTE = 'PrizePicks needs picks from at least two teams. A two-pick same-team lineup is often not a valid slip. Same-game and same-team multi-picks can pay less — check the multiplier shown before you submit.'
export const FREE_UPSELL = 'Teammate pair rates are part of All-Access. Upgrade to see agreement and sample size. Nothing here is a pick.'
export const PREVIEW_UPSELL = 'Pair rates are still on the free preview, so the numbers stay hidden.'
export const EMPTY_PAIRS = 'No teammate overs on today’s board clear the published hit-together bar for this prop.'
export const LIMITED_PAIRS = 'This list is counting stats only. Steals, blocks, and other markets stay off it.'
export const UNAVAILABLE_PAIRS = 'Pair history isn’t available right now.'
export const LOADING_PAIRS = 'Loading pair history…'
export const BARS_STUB_NOTE = 'L10 bars are a placeholder. They would show this teammate only in games the selected prop hit, oldest on the left. Those sequences are not in the published pairs yet.'
export const BARS_SHORT_NOTE = 'Bars stay blank under 5 A-hit games.'
export const LINE_SOURCE_COPY = {
  saved_pp_standard: 'Line source: saved PrizePicks standard pre-game line (saved_pp_standard).',
  current_line_retro: 'Line source: current line applied back to the logs (current_line_retro).',
  missing: 'Line source: not in the published pairs yet (saved_pp_standard vs current_line_retro).',
  mixed: 'Line source differs by teammate (saved_pp_standard or current_line_retro).',
}

const A_HIT_KEYS = ['nAHits', 'aHits', 'n_a_hits']
const BAR_KEYS = ['l10', 'conditionalBars', 'aHitBars']
const LINE_SOURCE_CODES = new Set(['saved_pp_standard', 'current_line_retro'])

export function historicalLine(anchor) {
  const name = String(anchor?.name || 'this prop').trim() || 'this prop'
  const stat = String(anchor?.stat || 'prop').trim() || 'prop'
  return `Historical when ${name} ${stat} hit — not a projection.`
}

export function metricGapNote(usesAgreement) {
  const rate = usesAgreement
    ? 'The percent is published agreement (same side across n shared decisions), not how often the teammate hit in games this prop hit.'
    : 'The percent is the conditional hit rate on the published pair.'
  return `${rate} Season-to-date is capped at ${LOOKBACK_CAP} in the cleared rule; this file’s n is not trimmed to that. A-hit floors apply only when the pair includes that count.`
}

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

function panelChrome(anchor) {
  return {
    title: CORR_TITLE,
    historical: historicalLine(anchor),
    banner: CORR_BANNER,
    ppNote: PP_NOTE,
    ageLine: STANDARD_LINE,
    scopeNote: SCOPE_NOTE,
    oversNote: anchor?.side === 'UNDER' ? OVERS_NOTE : '',
  }
}

function lineSourceNote(codes) {
  const unique = [...new Set(codes.filter(Boolean))]
  if (!unique.length) return LINE_SOURCE_COPY.missing
  if (unique.length > 1) return LINE_SOURCE_COPY.mixed
  return LINE_SOURCE_COPY[unique[0]] || LINE_SOURCE_COPY.missing
}

// Entitled members only. Free and preview snapshots get chrome and an upsell,
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
  const chrome = panelChrome(anchor)
  if (loading) {
    return { ...chrome, status: 'loading', showNumbers: false, message: LOADING_PAIRS, rows: [], metricNote: '', lineSourceNote: '', barsNote: '', barsStub: false }
  }
  if (!entitled) {
    return {
      ...chrome,
      status: 'locked',
      showNumbers: false,
      message: memberPreview ? PREVIEW_UPSELL : FREE_UPSELL,
      showPlans: !memberPreview,
      rows: [],
      metricNote: '',
      lineSourceNote: '',
      barsNote: '',
      barsStub: false,
    }
  }
  if (!doc || doc.unavailable === true || !Array.isArray(doc.pairs)) {
    return { ...chrome, status: 'unavailable', showNumbers: false, message: UNAVAILABLE_PAIRS, rows: [], metricNote: '', lineSourceNote: '', barsNote: '', barsStub: false }
  }
  const allowedAnchor = new Set(anchorStats)
  if (!allowedAnchor.has(anchor.stat)) {
    return { ...chrome, status: 'limited', showNumbers: false, message: LIMITED_PAIRS, rows: [], metricNote: metricGapNote(true), lineSourceNote: '', barsNote: '', barsStub: false }
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
    return {
      ...chrome,
      status: 'empty',
      showNumbers: false,
      message: EMPTY_PAIRS,
      rows: [],
      metricNote: metricGapNote(true),
      lineSourceNote: lineSourceNote([readLineSource(null, doc)]),
      barsNote: '',
      barsStub: false,
    }
  }

  const usesAgreement = rows.some((row) => row.kind === 'agreement')
  const allStub = rows.every((row) => row.barsMode === 'stub')
  const publicRows = allStub
    ? rows.map((row) => ({ ...row, barsMode: 'stub', bars: null }))
    : rows
  return {
    ...chrome,
    status: 'ready',
    showNumbers: true,
    message: '',
    rows: publicRows,
    metricNote: metricGapNote(usesAgreement),
    lineSourceNote: lineSourceNote(rows.map((row) => row.lineSource)),
    barsNote: allStub ? BARS_STUB_NOTE : '',
    barsStub: allStub,
  }
}

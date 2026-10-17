// Standard PrizePicks lines only. The same rule as the API: a row with no
// odds-type field stays (rankings, lineups, totals, unlabeled props). A
// present type stays only when it is exactly "standard", so goblin, demon,
// blank, and unknown tokens are dropped.

const LABELS = ['odds_type', 'oddsType', 'line_type', 'lineType']

export function rawOddsType(row) {
  if (!row || typeof row !== 'object') return ''
  for (const key of LABELS) {
    const raw = row[key]
    if (raw == null) continue
    const text = String(raw).trim().toLowerCase()
    if (text) return text
  }
  return ''
}

// undefined: no odds-type field, or the field is null. '' is a present blank.
export function explicitBoardOddsType(row) {
  if (!row || typeof row !== 'object') return undefined
  for (const key of LABELS) {
    if (!Object.hasOwn(row, key) || row[key] == null) continue
    return String(row[key]).trim().toLowerCase()
  }
  return undefined
}

export function isStandardBoardLine(row) {
  const type = explicitBoardOddsType(row)
  if (type === undefined) return true
  return type === 'standard'
}

const ROW_DATASETS = new Set(['nhl_projections', 'nfl_projections'])
const PROJECTION_LIST = new Set(['strikeout_projections', 'batter_projections'])
const PLAYER_STANDARD = new Set(['wnba_projections_standard', 'nba_projections_standard'])
const PLAYER_PROMO = new Set([
  'wnba_projections_demon',
  'wnba_projections_goblin',
  'nba_projections_demon',
  'nba_projections_goblin',
])

function filterRows(rows) {
  if (!Array.isArray(rows)) return rows
  let changed = false
  const kept = []
  for (const row of rows) {
    if (!isStandardBoardLine(row)) {
      changed = true
      continue
    }
    kept.push(row)
  }
  return changed ? kept : rows
}

function filterPlayer(player) {
  if (!player || typeof player !== 'object') return player
  if (!Array.isArray(player.ppAllProps)) return player
  const props = filterRows(player.ppAllProps)
  return props === player.ppAllProps ? player : { ...player, ppAllProps: props }
}

function round1(value) {
  return Math.round(value * 10) / 10
}

function round2(value) {
  return Math.round(value * 100) / 100
}

function groupHitRate(rows, keyName) {
  const groups = {}
  for (const row of rows) {
    const key = row?.[keyName]
    if (!groups[key]) groups[key] = { hits: 0, misses: 0 }
    if (row.result === 'HIT') groups[key].hits += 1
    else groups[key].misses += 1
  }
  for (const key of Object.keys(groups)) {
    const total = groups[key].hits + groups[key].misses
    groups[key].total = total
    groups[key].hit_rate = total ? round1((groups[key].hits / total) * 100) : 0
  }
  return groups
}

// Same fields generate_graded_history.py writes, counted from the rows that
// remain after goblin and demon lines are removed.
export function summaryForGradedRows(graded, pending) {
  const rows = Array.isArray(graded) ? graded : []
  const waiting = Array.isArray(pending) ? pending : []
  const resolved = rows.filter((row) => row?.result === 'HIT' || row?.result === 'MISS')
  const hits = resolved.filter((row) => row.result === 'HIT').length
  const misses = resolved.length - hits
  const overEntries = resolved.filter((row) => row.type === 'OVER' || row.type === 'SLIGHT OV')
  const underEntries = resolved.filter((row) => row.type === 'UNDER' || row.type === 'SLIGHT UN')
  const overHits = overEntries.filter((row) => row.result === 'HIT').length
  const underHits = underEntries.filter((row) => row.result === 'HIT').length
  const edges = rows
    .filter((row) => row?.edge != null && Number.isFinite(Number(row.edge)))
    .map((row) => Number(row.edge))
  return {
    total_graded: rows.length,
    total_pending: waiting.length,
    hits,
    misses,
    overall_hit_rate: resolved.length ? round1((hits / resolved.length) * 100) : 0,
    over_hit_rate: overEntries.length ? round1((overHits / overEntries.length) * 100) : 0,
    under_hit_rate: underEntries.length ? round1((underHits / underEntries.length) * 100) : 0,
    over_volume: overEntries.length,
    under_volume: underEntries.length,
    avg_edge: edges.length ? round2(edges.reduce((sum, edge) => sum + edge, 0) / edges.length) : 0,
    by_stat: groupHitRate(resolved, 'stat'),
    by_role: groupHitRate(resolved, 'role'),
  }
}

export function withStandardGradedHistory(payload) {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return payload
  if (!Array.isArray(payload.graded) && !Array.isArray(payload.pending)) return payload
  let changed = false
  const next = { ...payload }
  for (const key of ['graded', 'pending']) {
    if (!Array.isArray(payload[key])) continue
    const filtered = filterRows(payload[key])
    if (filtered !== payload[key]) {
      changed = true
      next[key] = filtered
    }
  }
  if (!changed) return payload
  if (payload.summary && typeof payload.summary === 'object') {
    next.summary = summaryForGradedRows(next.graded ?? payload.graded, next.pending ?? payload.pending)
  }
  return next
}

// #205's general walk: every dataset this file does not shape itself still
// drops a present non-standard odds type (goblin, demon, blank, unknown) and
// keeps a row that has no odds-type field. Nested props, records, and line
// maps are walked the same way. An object is returned unchanged when nothing
// was removed.
function filterLineMap(value) {
  if (Array.isArray(value)) return filterGeneralList(value)
  if (!value || typeof value !== 'object') return value
  let changed = false
  const out = {}
  for (const [key, entry] of Object.entries(value)) {
    if (entry && typeof entry === 'object' && !isStandardBoardLine(entry)) {
      changed = true
      continue
    }
    out[key] = entry
  }
  return changed ? out : value
}

function filterGeneralList(rows) {
  if (!Array.isArray(rows)) return rows
  let changed = false
  const kept = []
  for (const row of rows) {
    if (!isStandardBoardLine(row)) {
      changed = true
      continue
    }
    const next = filterGeneralPayload(row)
    if (next !== row) changed = true
    kept.push(next)
  }
  return changed ? kept : rows
}

function filterGeneralPayload(payload) {
  if (Array.isArray(payload)) return filterGeneralList(payload)
  if (!payload || typeof payload !== 'object') return payload
  let changed = false
  const next = { ...payload }
  for (const key of ['props', 'ppAllProps', 'projections', 'records', 'pending', 'graded']) {
    if (!Array.isArray(payload[key])) continue
    const filtered = filterGeneralList(payload[key])
    if (filtered !== payload[key]) {
      changed = true
      next[key] = filtered
    }
  }
  for (const key of ['ppLines', 'ppLinesStandard']) {
    if (payload[key] == null) continue
    const filtered = filterLineMap(payload[key])
    if (filtered !== payload[key]) {
      changed = true
      next[key] = filtered
    }
  }
  if (Array.isArray(payload.cards)) {
    const filtered = filterGeneralList(payload.cards)
    const nonempty = filtered.filter((card) => !Array.isArray(card?.props) || card.props.length > 0)
    const finalCards = nonempty.length === filtered.length ? filtered : nonempty
    if (finalCards !== payload.cards) {
      changed = true
      next.cards = finalCards
    }
  }
  if (Array.isArray(payload.matchups)) {
    const filtered = filterGeneralList(payload.matchups)
    if (filtered !== payload.matchups) {
      changed = true
      next.matchups = filtered
    }
  }
  if (changed && payload.summary && typeof payload.summary === 'object' && (next.graded || next.pending)) {
    next.summary = summaryForGradedRows(next.graded ?? payload.graded, next.pending ?? payload.pending)
  }
  return changed ? next : payload
}

// Returns a new payload. The cached snapshot is left untouched.
export function filterStandardBoard(ds, payload) {
  if (ROW_DATASETS.has(ds)) return withStandardGradedHistory(filterRows(payload))
  if (PROJECTION_LIST.has(ds)) {
    if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return payload
    const projections = filterRows(payload.projections)
    const next = projections === payload.projections ? payload : { ...payload, projections }
    return withStandardGradedHistory(next)
  }
  if (ds === 'prizepicks_props') {
    if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return payload
    const cards = Array.isArray(payload.cards) ? payload.cards : []
    const nextCards = []
    let changed = false
    for (const card of cards) {
      const props = filterRows(Array.isArray(card?.props) ? card.props : [])
      if (!props.length) {
        changed = true
        continue
      }
      if (props !== card.props) changed = true
      nextCards.push(props === card.props ? card : { ...card, props })
    }
    if (!changed && nextCards.length === cards.length) return withStandardGradedHistory(payload)
    const total = nextCards.reduce((sum, card) => sum + card.props.length, 0)
    return withStandardGradedHistory({ ...payload, cards: nextCards, ...(payload.total_props != null ? { total_props: total } : {}) })
  }
  if (PLAYER_STANDARD.has(ds) || PLAYER_PROMO.has(ds)) {
    const players = Array.isArray(payload) ? payload : []
    const next = []
    let changed = false
    for (const player of players) {
      const filtered = filterPlayer(player)
      if (filtered !== player) changed = true
      // Drop only a player whose list the filter emptied. A player who already
      // had no props (ppAllProps: []) stays, so a paid WNBA board keeps its count.
      const hadProps = Array.isArray(player?.ppAllProps) && player.ppAllProps.length > 0
      if (hadProps && Array.isArray(filtered?.ppAllProps) && filtered.ppAllProps.length === 0) {
        changed = true
        continue
      }
      next.push(filtered)
    }
    return changed ? next : payload
  }
  return filterGeneralPayload(payload)
}

// NHL sharp-odds rows are stored with line_type null on standard lines and on
// demon lines. A missing type cannot separate them. WNBA goblin and demon
// props also have no type field; there the dataset name is the signal, so
// this join is not applied to those datasets.
export function projectionRowId(row) {
  const raw = row?.id ?? row?.projection_id
  if (raw == null) return ''
  return String(raw).trim()
}

export function standardProjectionIdSet(rows) {
  const ids = new Set()
  for (const row of Array.isArray(rows) ? rows : []) {
    const id = projectionRowId(row)
    if (id) ids.add(id)
  }
  return ids
}

// Keep a sharp-odds row only when its id is on the standard board. A missing
// id, or an id that is not on that board, is unknown and drops.
export function filterNhlSharpOdds(payload, standardIds) {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return payload
  if (!Array.isArray(payload.records)) return payload
  const allowed = standardIds instanceof Set ? standardIds : standardProjectionIdSet(standardIds)
  let changed = false
  const records = []
  for (const row of payload.records) {
    const id = projectionRowId(row)
    if (!id || !allowed.has(id)) {
      changed = true
      continue
    }
    records.push(row)
  }
  return changed ? { ...payload, records } : payload
}

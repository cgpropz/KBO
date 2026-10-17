// Standard PrizePicks lines only. Demon, goblin, blank, and unknown types
// never reach a member board, dashboard, or the slip builder.
// WNBA and NBA standard snapshots omit the field; that absence is standard
// only for those two datasets. Everywhere else a missing type is dropped.

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

export function isStandardBoardLine(row, { missingIsStandard = false } = {}) {
  const type = rawOddsType(row)
  if (!type) return missingIsStandard === true
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

function filterRows(rows, missingIsStandard) {
  return (Array.isArray(rows) ? rows : []).filter((row) => isStandardBoardLine(row, { missingIsStandard }))
}

function filterPlayer(player, missingIsStandard) {
  if (!player || typeof player !== 'object') return player
  if (!Array.isArray(player.ppAllProps)) return player
  return { ...player, ppAllProps: filterRows(player.ppAllProps, missingIsStandard) }
}

// Returns a new payload. The cached snapshot is left untouched.
export function filterStandardBoard(ds, payload) {
  if (ROW_DATASETS.has(ds)) return filterRows(payload, false)
  if (PROJECTION_LIST.has(ds)) {
    if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return payload
    const projections = filterRows(payload.projections, false)
    return projections === payload.projections ? payload : { ...payload, projections }
  }
  if (ds === 'prizepicks_props') {
    if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return payload
    const cards = Array.isArray(payload.cards) ? payload.cards : []
    const nextCards = []
    let changed = false
    for (const card of cards) {
      const props = filterRows(card?.props, false)
      if (!props.length) {
        changed = true
        continue
      }
      if (props.length !== (Array.isArray(card?.props) ? card.props.length : 0)) changed = true
      nextCards.push(props === card.props ? card : { ...card, props })
    }
    if (!changed && nextCards.length === cards.length) return payload
    const total = nextCards.reduce((sum, card) => sum + card.props.length, 0)
    return { ...payload, cards: nextCards, ...(payload.total_props != null ? { total_props: total } : {}) }
  }
  if (PLAYER_STANDARD.has(ds) || PLAYER_PROMO.has(ds)) {
    const missingIsStandard = PLAYER_STANDARD.has(ds)
    const players = Array.isArray(payload) ? payload : []
    const next = []
    for (const player of players) {
      const filtered = filterPlayer(player, missingIsStandard)
      if (Array.isArray(filtered?.ppAllProps) && filtered.ppAllProps.length === 0) continue
      next.push(filtered)
    }
    return next
  }
  return payload
}

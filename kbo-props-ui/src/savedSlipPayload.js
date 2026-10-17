import { inferSlipSport, normalizeSport } from './slipSportInfer.js'

function num(value) {
  if (value == null || value === '') return null
  const n = Number(value)
  return Number.isFinite(n) ? n : null
}

function text(value) {
  const raw = String(value ?? '').trim()
  return raw || null
}

function projectionIdOf(leg) {
  for (const key of ['projection_id', 'projectionId']) {
    if (leg?.[key] == null) continue
    const raw = String(leg[key]).trim()
    if (raw) return raw
  }
  if (leg?.id == null) return null
  const id = String(leg.id).trim()
  if (!id) return null
  const playerId = String(leg.playerId ?? leg.player_id ?? '').trim()
  if (playerId && playerId === id) return null
  return id
}

export function cleanSavedLeg(leg, sport) {
  const sideRaw = String(leg?.side || '').toUpperCase()
  const side = sideRaw === 'UNDER' || sideRaw === 'LESS' ? 'UNDER' : 'OVER'
  const legSport = normalizeSport(leg?.sport) || normalizeSport(sport) || null
  return {
    name: String(leg?.name || ''),
    team: String(leg?.team || ''),
    opponent: String(leg?.opponent || ''),
    prop: String(leg?.prop || ''),
    propShort: String(leg?.propShort || leg?.prop_short || ''),
    line: num(leg?.line),
    projection: num(leg?.projection),
    edge: num(leg?.edge),
    side,
    sport: legSport,
    odds_type: text(leg?.odds_type ?? leg?.oddsType ?? leg?.line_type ?? leg?.lineType),
    projection_id: projectionIdOf(leg),
    player_id: text(leg?.player_id ?? leg?.playerId),
    status: text(leg?.status),
    injury: text(leg?.injury),
    pp_status: text(leg?.ppStatus ?? leg?.pp_status),
    result: 'pending',
    actual: null,
  }
}

export function savedLegFromProp(prop, side, sport) {
  return cleanSavedLeg({ ...prop, side: side || prop?.side }, sport)
}

export function buildSavedSlipRow(body) {
  const incoming = body && typeof body === 'object' ? body : {}
  const sport = normalizeSport(incoming.sport) || inferSlipSport(incoming) || null
  const legs = Array.isArray(incoming.legs) ? incoming.legs.map((leg) => cleanSavedLeg(leg, sport)) : []
  return {
    game_date: incoming.game_date,
    confidence: num(incoming.confidence),
    avg_edge: num(incoming.avg_edge),
    total_edge: num(incoming.total_edge),
    unique_games: num(incoming.unique_games),
    sport,
    legs,
  }
}

export function sportColumnMissing(error) {
  if (!error) return false
  const code = String(error.code || error.details || '').toUpperCase()
  const message = `${error.message || ''} ${error.details || ''} ${error.hint || ''}`.toLowerCase()
  if (!message.includes('sport') && code !== '42703' && code !== 'PGRST204') return false
  return message.includes('sport') && (
    message.includes('column')
    || message.includes('schema')
    || code === '42703'
    || code === 'PGRST204'
  )
}

import { fetchData } from './dataUrl'
import { fetchApiDataset } from './apiData'
import { fetchWnbaData } from './wnba/wnbaData'
import { fetchNbaData } from './nba/nbaData'
import { fetchNflProjections } from './nfl/nflData'
import { fetchNhlProjections } from './nhl/nhlData'
import { compareSlipRows } from './slipBoardModel.js'
import { isStandardLine, oddsTypeOf, standardSlipRows } from './slipLines'
import { normalizePlayerName } from './memberHub.js'
import { kboModelProjection } from './kboBoardScore.js'
import {
  kboBoardIsOpen,
  kboEmptyState,
  keepSlipRow,
  playsOnDay,
  wnbaEmptyState,
} from './slipAvailability'

const KBO_TEAMS = {
  Doosan: '#9595d3', Hanwha: '#ff8c00', Kia: '#ff4444', Kiwoom: '#d4a76a',
  KT: '#e0e0e0', LG: '#e8557a', Lotte: '#ff6666', NC: '#5b9bd5',
  Samsung: '#60a5fa', SSG: '#ff5555',
}

const BASKET_SHORT = {
  Points: 'PTS', Rebounds: 'REB', Assists: 'AST', '3-PT Made': '3PM',
  Steals: 'STL', Blocks: 'BLK', 'Blocked Shots': 'BLK', Turnovers: 'TOV',
  'Fantasy Score': 'FANT', 'Pts+Rebs+Asts': 'PRA', 'Pts+Rebs': 'PR',
  'Pts+Asts': 'PA', 'Rebs+Asts': 'RA', 'Reb+Asts': 'RA', 'Blks+Stls': 'BS',
  'Double-Double': 'DD', 'Triple-Double': 'TD',
}

const NFL_SHORT = {
  'Pass Yards': 'PY', 'Pass Attempts': 'PA', 'Pass Completions': 'PC', 'Pass TDs': 'PTD',
  'Pass+Rush Yds': 'P+R', 'Rush Yards': 'RY', 'Rush Attempts': 'RA', 'Rush+Rec Yds': 'R+R',
  'Receiving Yards': 'RecY', Receptions: 'REC', 'Rec Targets': 'TGT',
}

const NHL_SHORT = {
  'Shots On Goal': 'SOG', Points: 'PTS', 'Power Play Points': 'PPP', 'Goalie Saves': 'SV',
}

function num(value) {
  const n = Number(value)
  return Number.isFinite(n) ? n : null
}

export { isPromoLine, isStandardLine, matchImportedPick, oddsTypeOf } from './slipLines'

function sportDate(timeZone) {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone, year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(new Date())
}

function kboShort(prop) {
  if (prop === 'Strikeouts') return 'K'
  if (prop === 'Hits Allowed') return 'HA'
  if (prop === 'Pitching Outs') return 'OUTS'
  if (prop === 'Hits+Runs+RBIs') return 'HRR'
  if (prop === 'Total Bases') return 'TB'
  if (prop === 'Fantasy Score') return 'FANT'
  return 'P'
}

function byCg(a, b) {
  return compareSlipRows(a, b, true)
}

function firstText(...values) {
  for (const value of values) {
    const text = String(value ?? '').trim()
    if (text) return text
  }
  return ''
}

function slipFields(row, extra = {}) {
  return {
    name: extra.name,
    team: extra.team || '',
    opponent: extra.opponent || '',
    prop: extra.prop,
    propShort: extra.propShort,
    line: extra.line,
    projection: extra.projection,
    edge: extra.edge,
    position: row?.position || row?.pos || extra.position || '',
    odds_type: oddsTypeOf(row),
    playerId: row?.playerId || row?.player_id || extra.playerId || null,
    imageUrl: firstText(extra.imageUrl, row?.imageUrl, row?.image, row?.photoUrl),
    ppImageUrl: firstText(extra.ppImageUrl, row?.ppImageUrl, row?.image_url),
    hitRate: num(row?.hitRate),
    gamesL10: num(row?.gamesL10),
    recent: Array.isArray(row?.recent) ? row.recent : [],
    start_time: row?.start_time || row?.startTime || row?.start_time_utc || extra.start_time || null,
    gameday: row?.gameday || row?.gameDate || row?.game_date || extra.gameday || null,
    started: row?.started === true || extra.started === true,
    locked: row?.locked === true || extra.locked === true,
    removed: row?.removed === true || extra.removed === true,
    status: row?.status ?? row?.injury_status ?? extra.status ?? null,
    injury: row?.injury ?? row?.injuryStatus ?? extra.injury ?? null,
    ppStatus: row?.pp_status ?? row?.ppStatus ?? row?.board_status ?? extra.ppStatus ?? null,
    held: row?.held === true || extra.held === true,
    awayTeam: row?.awayTeam || extra.awayTeam || '',
    homeTeam: row?.homeTeam || extra.homeTeam || '',
    sport: extra.sport || row?.sport || '',
    projection_id: row?.projection_id || extra.projection_id || null,
  }
}

async function loadKboProps() {
  let board = null
  try {
    board = await fetchData('prizepicks_props.json')
  } catch {
    return { props: [], empty: { title: 'Board unavailable', detail: 'The KBO board did not load.' } }
  }
  if (!kboBoardIsOpen(board)) {
    return { props: [], empty: kboEmptyState(board?.next_game) }
  }
  const [pitchers, batters, photos] = await Promise.all([
    fetchData('strikeout_projections.json').catch(() => null),
    fetchData('batter_projections.json').catch(() => null),
    fetchData('player_photos.json').catch(() => ({})),
  ])
  const photoByName = new Map()
  const photoTable = photos && typeof photos === 'object' && !Array.isArray(photos) ? photos : {}
  for (const [name, url] of Object.entries(photoTable)) {
    const key = normalizePlayerName(name)
    if (key && typeof url === 'string' && url.trim()) photoByName.set(key, url.trim())
  }
  const ppByName = new Map()
  for (const card of board?.cards || []) {
    const key = normalizePlayerName(card?.name)
    const url = firstText(card?.image_url, card?.ppImageUrl)
    if (key && url) ppByName.set(key, url)
  }
  const props = []
  for (const row of standardSlipRows([...(pitchers?.projections || []), ...(batters?.projections || [])])) {
    const line = num(row?.line)
    // No model number (null/'' projection or formula_source 'none'): skip
    // before num(), which would turn null into PROJ 0 / CG 0 / LESS.
    const projection = kboModelProjection(row)
    if (!row?.name && !row?.player) continue
    if (line == null || projection == null) continue
    const key = normalizePlayerName(row.name || row.player)
    const built = slipFields(row, {
      name: row.name || row.player,
      team: row.team || '',
      opponent: row.opponent || '',
      prop: row.prop,
      propShort: kboShort(row.prop),
      line,
      projection,
      edge: num(row.edge) ?? Math.round((projection - line) * 100) / 100,
      imageUrl: photoByName.get(key) || '',
      ppImageUrl: ppByName.get(key) || '',
      sport: 'kbo',
    })
    if (!keepSlipRow(built)) continue
    props.push(built)
  }
  props.sort(byCg)
  return { props, empty: null }
}

function lineTypePresent(row) {
  if (!row || typeof row !== 'object') return false
  return [row.odds_type, row.oddsType, row.line_type, row.lineType].some((value) => (
    value != null && String(value).trim() !== ''
  ))
}

// A row with no odds-type field is already standard. The standard basketball
// file still stamps odds_type so the slip row is labeled. A present goblin
// or demon keeps its type and is dropped.
function basketLine(player, prop, fillMissingStandard) {
  const merged = { ...player, ...prop }
  if (!fillMissingStandard || lineTypePresent(merged)) return merged
  const cleaned = { ...merged }
  for (const key of ['odds_type', 'oddsType', 'line_type', 'lineType']) {
    if (cleaned[key] == null || String(cleaned[key]).trim() === '') delete cleaned[key]
  }
  return { odds_type: 'standard', ...cleaned }
}

function basketRows(players, { source = '', sport = '' } = {}) {
  const fillMissingStandard = source === 'projections_standard.json'
  const props = []
  const seen = new Set()
  for (const player of Array.isArray(players) ? players : []) {
    const name = player?.name || player?.player
    const team = player?.team || ''
    const opponent = player?.dvpOpponent || player?.opponent || ''
    for (const prop of player?.ppAllProps || []) {
      const stat = prop?.stat || prop?.prop
      const line = num(prop?.line)
      if (!name || !stat || line == null) continue
      const lineRow = basketLine(player, prop, fillMissingStandard)
      if (!isStandardLine(lineRow)) continue
      const key = `${name}|${stat}|${line}|${oddsTypeOf(lineRow)}`
      if (seen.has(key)) continue
      seen.add(key)
      const projection = num(prop?.projection)
      const edge = projection == null ? 0 : Math.round((projection - line) * 100) / 100
      const built = slipFields(lineRow, {
        name,
        team,
        opponent: prop?.opponent || opponent,
        prop: stat,
        propShort: BASKET_SHORT[stat] || stat,
        line,
        projection,
        edge,
        position: player?.position || '',
        playerId: player?.playerId || player?.player_id || null,
        imageUrl: firstText(player?.image, player?.imageUrl, player?.photoUrl),
        ppImageUrl: firstText(player?.ppImageUrl, player?.image_url),
        start_time: player?.start_time || player?.startTime || null,
        gameday: player?.gameday || player?.gameDate || player?.game_date || null,
        started: player?.started,
        locked: player?.locked,
        removed: player?.removed,
        status: player?.status,
        injury: player?.injury,
        ppStatus: player?.ppStatus || player?.pp_status,
        held: player?.held,
        sport,
      })
      if (!keepSlipRow(built, { player })) continue
      props.push(built)
    }
  }
  props.sort(byCg)
  return props
}

async function loadBasketProps(fetchDataFile, { emptyWhenNoGame = false, timeZone = 'America/New_York', sport = '' } = {}) {
  const source = 'projections_standard.json'
  const doc = await fetchDataFile(source).catch(() => [])
  const players = Array.isArray(doc) ? doc : []
  if (emptyWhenNoGame && !playsOnDay(players, sportDate(timeZone), timeZone)) {
    return { props: [], empty: wnbaEmptyState() }
  }
  return { props: basketRows(players, { source, sport }), empty: null }
}

function flatRows(rows, shorts, { pointsGate = false, sport = '' } = {}) {
  const props = []
  for (const row of standardSlipRows(rows)) {
    const name = row?.player || row?.name
    const stat = row?.prop || row?.stat
    const line = num(row?.line)
    if (!name || !stat || line == null) continue
    if (!isStandardLine(row)) continue
    const projection = num(row?.projection)
    const edge = num(row?.edge) ?? (projection == null ? 0 : Math.round((projection - line) * 100) / 100)
    const built = slipFields(row, {
      name,
      team: row.team || '',
      opponent: row.opponent || '',
      prop: stat,
      propShort: shorts[stat] || stat,
      line,
      projection,
      edge,
      sport,
    })
    if (!keepSlipRow(built, { pointsGate })) continue
    props.push(built)
  }
  props.sort(byCg)
  return props
}

const chip = (id, label, match) => ({ id, label, match })

export const SLIP_SPORTS = {
  kbo: {
    id: 'kbo',
    title: 'Slip Builder',
    theme: 'so-theme-kbo',
    timeZone: 'Asia/Seoul',
    teams: KBO_TEAMS,
    importKey: 'kbo_parlay_import',
    dataset: 'correlations_kbo',
    staticPath: 'correlations_kbo.json',
    minShared: 15,
    filters: [
      chip('all', 'All', () => true),
      chip('K', 'K', (row) => row.propShort === 'K'),
      chip('HRR', 'HRR', (row) => row.propShort === 'HRR'),
      chip('TB', 'TB', (row) => row.propShort === 'TB'),
    ],
    loadProps: loadKboProps,
  },
  wnba: {
    id: 'wnba',
    title: 'Slip Builder',
    theme: 'so-theme-wnba',
    timeZone: 'America/New_York',
    teams: {},
    dataset: 'correlations_wnba',
    staticPath: 'correlations_wnba.json',
    minShared: 8,
    filters: [
      chip('all', 'All', () => true),
      chip('PTS', 'PTS', (row) => row.propShort === 'PTS'),
      chip('REB', 'REB', (row) => row.propShort === 'REB'),
      chip('AST', 'AST', (row) => row.propShort === 'AST'),
      chip('PRA', 'PRA', (row) => row.propShort === 'PRA'),
    ],
    loadProps: () => loadBasketProps((file) => fetchWnbaData(`wnba/${file}`), { emptyWhenNoGame: true, sport: 'wnba' }),
  },
  nba: {
    id: 'nba',
    title: 'Slip Builder',
    theme: 'so-theme-nba',
    timeZone: 'America/New_York',
    teams: {},
    dataset: 'nba_correlations',
    staticPath: 'correlations_nba.json',
    minShared: 15,
    filters: [
      chip('all', 'All', () => true),
      chip('PTS', 'PTS', (row) => row.propShort === 'PTS'),
      chip('REB', 'REB', (row) => row.propShort === 'REB'),
      chip('AST', 'AST', (row) => row.propShort === 'AST'),
      chip('PRA', 'PRA', (row) => row.propShort === 'PRA'),
    ],
    loadProps: () => loadBasketProps((file) => fetchNbaData(`nba/${file}`), { sport: 'nba' }),
  },
  nfl: {
    id: 'nfl',
    title: 'Slip Builder',
    theme: 'so-theme-nfl',
    timeZone: 'America/New_York',
    teams: {},
    dataset: 'correlations_nfl',
    staticPath: 'correlations_nfl.json',
    minShared: 8,
    filters: [
      chip('all', 'All', () => true),
      chip('Pass', 'Pass', (row) => String(row.prop).startsWith('Pass')),
      chip('Rush', 'Rush', (row) => String(row.prop).startsWith('Rush')),
      chip('Rec', 'Rec', (row) => String(row.prop).startsWith('Rec') || row.prop === 'Receptions'),
    ],
    loadProps: async () => {
      const snapshot = await fetchNflProjections()
      return flatRows(snapshot.projections, NFL_SHORT, { sport: 'nfl' })
    },
  },
  nhl: {
    id: 'nhl',
    title: 'Slip Builder',
    theme: 'so-theme-nhl',
    timeZone: 'America/New_York',
    teams: {},
    dataset: 'nhl_correlations',
    staticPath: 'correlations_nhl.json',
    minShared: 15,
    filters: [
      chip('all', 'All', () => true),
      chip('SOG', 'SOG', (row) => row.propShort === 'SOG'),
      chip('PTS', 'PTS', (row) => row.propShort === 'PTS'),
      chip('PPP', 'PPP', (row) => row.propShort === 'PPP'),
      chip('SV', 'SV', (row) => row.propShort === 'SV'),
    ],
    loadProps: async () => {
      const snapshot = await fetchNhlProjections()
      return flatRows(snapshot.projections, NHL_SHORT, { pointsGate: true, sport: 'nhl' })
    },
  },
}

export function slipSport(id) {
  return SLIP_SPORTS[id] || SLIP_SPORTS.kbo
}

export async function loadCorrelations(sport) {
  const config = slipSport(sport)
  try {
    const snapshot = await fetchApiDataset(config.dataset, { devStaticPath: config.staticPath })
    return snapshot.data && typeof snapshot.data === 'object' ? snapshot.data : { pairs: [], minShared: config.minShared }
  } catch {
    return { pairs: [], minShared: config.minShared }
  }
}

export { sportDate }

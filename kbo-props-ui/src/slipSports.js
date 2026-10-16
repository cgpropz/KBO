import { fetchData } from './dataUrl'
import { fetchApiDataset } from './apiData'
import { fetchWnbaData } from './wnba/wnbaData'
import { fetchNbaData } from './nba/nbaData'
import { fetchNflProjections } from './nfl/nflData'
import { fetchNhlProjections } from './nhl/nhlData'
import { oddsTypeOf } from './slipLines'

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

async function loadKboProps() {
  const [pitchers, batters] = await Promise.all([
    fetchData('strikeout_projections.json').catch(() => null),
    fetchData('batter_projections.json').catch(() => null),
  ])
  const props = []
  for (const row of pitchers?.projections || []) {
    if (row.projection == null || row.edge == null) continue
    props.push({ ...row, propShort: kboShort(row.prop), odds_type: oddsTypeOf(row) })
  }
  for (const row of batters?.projections || []) {
    if (row.projection == null || row.edge == null) continue
    props.push({ ...row, propShort: kboShort(row.prop), odds_type: oddsTypeOf(row) })
  }
  props.sort((a, b) => Math.abs(b.edge) - Math.abs(a.edge))
  return props
}

function basketRows(players) {
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
      const key = `${name}|${stat}|${line}`
      if (seen.has(key)) continue
      seen.add(key)
      const projection = num(prop?.projection)
      const edge = projection == null ? 0 : Math.round((projection - line) * 100) / 100
      props.push({
        name,
        team,
        opponent: prop?.opponent || opponent,
        prop: stat,
        propShort: BASKET_SHORT[stat] || stat,
        line,
        projection,
        edge,
        rating: num(prop?.rating),
        odds_type: oddsTypeOf(prop),
      })
    }
  }
  props.sort((a, b) => Math.abs(b.edge) - Math.abs(a.edge))
  return props
}

async function loadBasketProps(fetchDataFile) {
  const files = ['projections_standard.json', 'projections_demon.json', 'projections_goblin.json']
  const docs = await Promise.all(files.map((file) => fetchDataFile(file).catch(() => [])))
  return basketRows(docs.flatMap((doc) => (Array.isArray(doc) ? doc : [])))
}

function flatRows(rows, shorts) {
  const props = []
  for (const row of Array.isArray(rows) ? rows : []) {
    const name = row?.player || row?.name
    const stat = row?.prop || row?.stat
    const line = num(row?.line)
    if (!name || !stat || line == null) continue
    const projection = num(row?.projection)
    const edge = num(row?.edge) ?? (projection == null ? 0 : Math.round((projection - line) * 100) / 100)
    props.push({
      name,
      team: row.team || '',
      opponent: row.opponent || '',
      prop: stat,
      propShort: shorts[stat] || stat,
      line,
      projection,
      edge,
      rating: num(row.rating),
      odds_type: oddsTypeOf(row),
      position: row.position || '',
    })
  }
  props.sort((a, b) => Math.abs(b.edge) - Math.abs(a.edge))
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
    loadProps: () => loadBasketProps((file) => fetchWnbaData(`wnba/${file}`)),
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
    loadProps: () => loadBasketProps((file) => fetchNbaData(`nba/${file}`)),
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
      return flatRows(snapshot.projections, NFL_SHORT)
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
      return flatRows(snapshot.projections, NHL_SHORT)
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

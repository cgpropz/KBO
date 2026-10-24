import { fetchApiDataset } from '../apiData'

const FILE_TO_DATASET = {
  'nba/players.json': 'nba_players',
  'nba/teams.json': 'nba_teams',
  'nba/dvp_pg.json': 'nba_dvp_pg',
  'nba/dvp_sg.json': 'nba_dvp_sg',
  'nba/dvp_sf.json': 'nba_dvp_sf',
  'nba/dvp_pf.json': 'nba_dvp_pf',
  'nba/dvp_c.json': 'nba_dvp_c',
  'nba/projections_standard.json': 'nba_projections_standard',
}

export async function fetchNbaSnapshot(path, { player, showAllLines = false } = {}) {
  const ds = FILE_TO_DATASET[path]
  if (!ds) throw new Error(`Unknown NBA data file: ${path}`)
  return fetchApiDataset(ds, { devStaticPath: path, player, showAllLines })
}

export async function fetchNbaData(path, options) {
  const snapshot = await fetchNbaSnapshot(path, options)
  return snapshot.data
}

export async function fetchNbaSharpOdds({ fresh = false, showAllLines = false } = {}) {
  const snapshot = await fetchApiDataset('nba_sharp_odds', { devStaticPath: 'nba/sharp_odds.json', fresh, showAllLines })
  const payload = snapshot.data && typeof snapshot.data === 'object' && !Array.isArray(snapshot.data)
    ? snapshot.data
    : { records: Array.isArray(snapshot.data) ? snapshot.data : [], status: 'ok' }
  return {
    payload,
    records: Array.isArray(payload.records) ? payload.records : [],
    updatedAt: snapshot.updatedAt,
    preview: snapshot.preview,
    lockedCount: snapshot.lockedCount,
  }
}

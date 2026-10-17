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

export async function fetchNbaSnapshot(path, { player } = {}) {
  const ds = FILE_TO_DATASET[path]
  if (!ds) throw new Error(`Unknown NBA data file: ${path}`)
  return fetchApiDataset(ds, { devStaticPath: path, player })
}

export async function fetchNbaData(path, options) {
  const snapshot = await fetchNbaSnapshot(path, options)
  return snapshot.data
}

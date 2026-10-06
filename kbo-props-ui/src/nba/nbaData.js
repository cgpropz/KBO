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
  'nba/projections_demon.json': 'nba_projections_demon',
  'nba/projections_goblin.json': 'nba_projections_goblin',
}

export async function fetchNbaData(path) {
  const ds = FILE_TO_DATASET[path]
  if (!ds) throw new Error(`Unknown NBA data file: ${path}`)
  const snapshot = await fetchApiDataset(ds, { devStaticPath: path })
  return snapshot.data
}

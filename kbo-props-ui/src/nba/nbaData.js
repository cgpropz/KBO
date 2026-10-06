import { fetchApiDataset } from '../apiData'

const FILE_TO_DATASET = {
  'nba/players.json': 'nba_players',
  'nba/teams.json': 'nba_teams',
}

export async function fetchNbaData(path) {
  const ds = FILE_TO_DATASET[path]
  if (!ds) throw new Error(`Unknown NBA data file: ${path}`)
  const snapshot = await fetchApiDataset(ds, { devStaticPath: path })
  return snapshot.data
}

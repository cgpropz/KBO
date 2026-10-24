import { fetchApiDataset } from '../apiData'

/*
 * WNBA snapshot loader. Every dataset is served by the server-gated
 * /api/data endpoint (full data for paid tiers, a preview for free users).
 * The local public/data/wnba/*.json files are only used as a dev fallback
 * and are no longer committed or deployed.
 */
const FILE_TO_DATASET = {
  'wnba/projections_standard.json': 'wnba_projections_standard',
  'wnba/players.json': 'wnba_players',
  'wnba/lineups.json': 'wnba_lineups',
  'wnba/dvp_guard.json': 'wnba_dvp_guard',
  'wnba/dvp_forward.json': 'wnba_dvp_forward',
  'wnba/dvp_center.json': 'wnba_dvp_center',
  'wnba/pp_line_matched_odds.json': 'wnba_sharp_odds',
}

// Returns { data, updatedAt, source, preview, lockedCount }.
export async function fetchWnbaSnapshot(path, { player, fresh = false, showAllLines = false } = {}) {
  const ds = FILE_TO_DATASET[path]
  if (!ds) throw new Error(`Unknown WNBA data file: ${path}`)
  return fetchApiDataset(ds, { devStaticPath: path, player, fresh, showAllLines })
}

export async function fetchWnbaData(path, options) {
  const snapshot = await fetchWnbaSnapshot(path, options)
  return snapshot.data
}

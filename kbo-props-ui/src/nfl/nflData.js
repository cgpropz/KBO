import { fetchApiDataset } from '../apiData'

/*
 * NFL loaders. Data comes from the server-gated /api/data endpoint: paid tiers
 * get every row, free users get the top rows plus a locked-row count.
 */
export async function fetchNflProjections() {
  const snapshot = await fetchApiDataset('nfl_projections')
  return {
    projections: Array.isArray(snapshot.data) ? snapshot.data : [],
    updatedAt: snapshot.updatedAt,
    preview: snapshot.preview,
    lockedCount: snapshot.lockedCount,
  }
}

export async function fetchNflLineups() {
  const snapshot = await fetchApiDataset('nfl_lineups')
  return {
    matchups: Array.isArray(snapshot.data) ? snapshot.data : [],
    updatedAt: snapshot.updatedAt,
    preview: snapshot.preview,
    lockedCount: snapshot.lockedCount,
  }
}

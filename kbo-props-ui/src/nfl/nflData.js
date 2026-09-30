import { fetchApiDataset } from '../apiData'

/*
 * NFL loaders. Data comes from the server-gated /api/data endpoint: paid tiers
 * get every row, free users get the top rows plus a locked-row count.
 */
export async function fetchNflProjections() {
  const snapshot = await fetchApiDataset('nfl_projections', { devStaticPath: 'nfl/projections.json' })
  return {
    projections: Array.isArray(snapshot.data) ? snapshot.data : [],
    updatedAt: snapshot.updatedAt,
    preview: snapshot.preview,
    lockedCount: snapshot.lockedCount,
  }
}

export async function fetchNflLineups() {
  const snapshot = await fetchApiDataset('nfl_lineups', { devStaticPath: 'nfl/lineups.json' })
  return {
    matchups: Array.isArray(snapshot.data) ? snapshot.data : [],
    updatedAt: snapshot.updatedAt,
    preview: snapshot.preview,
    lockedCount: snapshot.lockedCount,
  }
}

export async function fetchNflSharpOdds() {
  const snapshot = await fetchApiDataset('nfl_sharp_odds', { devStaticPath: 'nfl/sharp_odds.json' })
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

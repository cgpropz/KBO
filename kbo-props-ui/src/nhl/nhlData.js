import { fetchApiDataset } from '../apiData'

export async function fetchNhlProjections() {
  const snapshot = await fetchApiDataset('nhl_projections', { devStaticPath: 'nhl/projections.json' })
  return {
    projections: Array.isArray(snapshot.data) ? snapshot.data : [],
    updatedAt: snapshot.updatedAt,
    preview: snapshot.preview,
    lockedCount: snapshot.lockedCount,
  }
}

export async function fetchNhlLineups() {
  const snapshot = await fetchApiDataset('nhl_lineups', { devStaticPath: 'nhl/lineups.json' })
  return {
    matchups: Array.isArray(snapshot.data) ? snapshot.data : [],
    updatedAt: snapshot.updatedAt,
    preview: snapshot.preview,
    lockedCount: snapshot.lockedCount,
  }
}

export async function fetchNhlSharpOdds() {
  const snapshot = await fetchApiDataset('nhl_sharp_odds', { devStaticPath: 'nhl/sharp_odds.json' })
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

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
    refreshing: !!snapshot.refreshing,
  }
}

export async function fetchNflLineups() {
  const snapshot = await fetchApiDataset('nfl_lineups', { devStaticPath: 'nfl/lineups.json' })
  return {
    matchups: Array.isArray(snapshot.data) ? snapshot.data : [],
    updatedAt: snapshot.updatedAt,
    preview: snapshot.preview,
    lockedCount: snapshot.lockedCount,
    refreshing: !!snapshot.refreshing,
  }
}

export async function fetchNflGameMarkets() {
  const snapshot = await fetchApiDataset('nfl_game_markets', { devStaticPath: 'nfl/game_markets.json' })
  const payload = snapshot.data && typeof snapshot.data === 'object' && !Array.isArray(snapshot.data)
    ? snapshot.data
    : { games: Array.isArray(snapshot.data) ? snapshot.data : [], status: 'ok' }
  return {
    payload,
    games: Array.isArray(payload.games) ? payload.games : [],
    updatedAt: snapshot.updatedAt,
    preview: snapshot.preview,
    lockedCount: snapshot.lockedCount,
    refreshing: !!snapshot.refreshing,
  }
}

export async function fetchNflSharpOdds({ fresh = false } = {}) {
  const snapshot = await fetchApiDataset('nfl_sharp_odds', { devStaticPath: 'nfl/sharp_odds.json', fresh })
  const payload = snapshot.data && typeof snapshot.data === 'object' && !Array.isArray(snapshot.data)
    ? snapshot.data
    : { records: Array.isArray(snapshot.data) ? snapshot.data : [], status: 'ok' }
  return {
    payload,
    records: Array.isArray(payload.records) ? payload.records : [],
    updatedAt: snapshot.updatedAt,
    preview: snapshot.preview,
    lockedCount: snapshot.lockedCount,
    refreshing: !!snapshot.refreshing,
  }
}

// Opponent-adjusted defense vs position (nflverse). Free, team-level matchup
// context. One shared request per page load; a failure resolves to null so the
// board simply shows no "Adj" chip.
let matchupDefensePromise = null

export function fetchNflMatchupDefense() {
  if (!matchupDefensePromise) {
    matchupDefensePromise = fetchApiDataset('nfl_matchup_defense', { devStaticPath: 'nfl/matchup_defense.json' })
      .then((snapshot) => {
        const payload = snapshot?.data
        return payload && typeof payload === 'object' && !Array.isArray(payload) && payload.teams ? payload : null
      })
      .catch(() => {
        matchupDefensePromise = null
        return null
      })
  }
  return matchupDefensePromise
}

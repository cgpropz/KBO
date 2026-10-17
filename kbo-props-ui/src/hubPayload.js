// Compact board for the member hub. Built from the same row functions the hub
// already uses, so CG Score, standard-line filtering, and the points gate stay
// where they are. The full board snapshot is untouched. `detail` is the whole
// source row (NHL); the player page loads that log itself.

import { kboHubRows, nbaHubRows, nflHubRows, nhlHubRows, wnbaHubRows } from './memberHub.js'

const BY_DATASET = {
  prizepicks_props: (data) => kboHubRows(data, {}),
  nfl_projections: (data) => nflHubRows(data),
  nhl_projections: (data) => nhlHubRows(data),
  wnba_projections_standard: (data) => wnbaHubRows(data),
  nba_projections_standard: (data) => nbaHubRows(data),
}

const BY_SPORT = {
  kbo: 'prizepicks_props',
  nfl: 'nfl_projections',
  nhl: 'nhl_projections',
  wnba: 'wnba_projections_standard',
  nba: 'nba_projections_standard',
}

export const HUB_DATASETS = Object.keys(BY_DATASET)

export const HUB_TABLE = {
  prizepicks_props: 'kbo_hub',
  nfl_projections: 'nfl_hub',
  nhl_projections: 'nhl_hub',
  wnba_projections_standard: 'wnba_hub',
  nba_projections_standard: 'nba_hub',
}

const KEEP = [
  'player', 'team', 'opponent', 'stat', 'line', 'projection', 'side', 'score',
  'image', 'ppImageUrl', 'playerId', 'start', 'recent', 'hitRate', 'hitGames',
  'hitHits', 'oppRank', 'goalieStatus', 'statusLabel', 'status', 'injury',
  'ppStatus', 'held',
  // Still read after the trim: top 3 / L10 / counts (rank + line type) and
  // the next-gameday scope (start, plus gameday/date and the matchup sides).
  'rankEligible', 'line_type', 'oddsType', 'odds_type', 'gameday', 'date',
  'awayTeam', 'homeTeam', 'away', 'home', 'position',
]

function slim(row) {
  const out = {}
  for (const key of KEEP) {
    if (row?.[key] !== undefined) out[key] = row[key]
  }
  return out
}

export function hubPayload(ds, data) {
  const build = BY_DATASET[ds]
  if (!build) return data
  const rows = build(data).map(slim)
  return { hub: true, rows }
}

export function hubSnapshot(sport, data) {
  const ds = BY_SPORT[sport]
  if (!ds) throw new Error(`No hub snapshot for ${sport}`)
  return hubPayload(ds, data)
}

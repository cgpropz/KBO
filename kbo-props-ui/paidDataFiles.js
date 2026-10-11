// Paid snapshot files that must never be shipped as static assets.
// They are served only through the server-gated /api/data endpoint.
// Keep in sync with .vercelignore and the root .gitignore.
export const PAID_DATA_FILES = [
  'prizepicks_props.json',
  'strikeout_projections.json',
  'batter_projections.json',
  'batter_projections.last_good.json',
  'batter_projections_dev.json',
  'matchup_data.json',
  'pitcher_logs.json',
  'prop_results.json',
  'pitcher_rankings.json',
  'pitcher_rankings_meta.json',
  'graded_props_history.json',
  'correlations_kbo.json',
  'correlations_wnba.json',
  'correlations_nfl.json',
  'correlations_nba.json',
  'correlations_nhl.json',
]

// Whole directories under public/data that are paid.
export const PAID_DATA_DIRS = ['wnba', 'nfl', 'nba', 'nhl']

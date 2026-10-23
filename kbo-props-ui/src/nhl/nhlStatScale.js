// NHL stat directions and position baselines for the shared Splits /
// Advanced strength-weakness scale (the scale itself lives in #384's
// playerInsights code; this file only registers NHL data for it).
// Display only: nothing here feeds the model, CG Score, ranking or gating.

// 'higher': a bigger number is a strength. 'lower': a smaller number is a
// strength. 'neutral': no good/bad reading (usage context), leave uncolored.
export const NHL_STAT_DIRECTIONS = Object.freeze({
  // Props on the NHL board: more is a strength for the over.
  sog: 'higher', pts: 'higher', ppp: 'higher', sv: 'higher', g: 'higher', a: 'higher',
  // Skater advanced (NHL API game logs)
  shPct: 'higher', sog60: 'higher', ppPts: 'higher', pts60: 'higher',
  evToi: 'higher', ppToi: 'higher', shToi: 'neutral', ppShare: 'higher',
  foPct: 'higher', blocks: 'higher', hits: 'higher', shifts: 'neutral',
  // Goalie advanced
  svPct: 'higher', gaa: 'lower', saves: 'higher',
  // More shots against means more save chances for the Saves prop, but it is
  // a team-defense weakness, so it stays uncolored.
  sa: 'neutral',
  // Lower is better
  goalsAgainst: 'lower', ga: 'lower', giveaways: 'lower', pim: 'lower',
  // Opponent defense rank: 1 = best defense, so a low rank is a tough matchup.
  oppDefRank: 'lower',
})

export function nhlStatDirection(id) {
  return NHL_STAT_DIRECTIONS[id] || 'higher'
}

// League baselines by position group, 2025-26 regular season, pooled totals
// (sum / sum) over skaters with 20+ games and goalies with 20+ games.
// Faceoff % is over centers with 20+ games and 100+ draws.
// Source: api.nhle.com/stats/rest skater summary, timeonice, realtime,
// faceoffwins and goalie summary (season totals). Rates are fractions; TOI is
// minutes per game. Refresh once a season.
export const NHL_BASELINE_SEASON = '2025-26'
export const NHL_BASELINE_SOURCE = 'NHL stats API, 2025-26 regular season'
export const NHL_POSITION_BASELINES = Object.freeze({
  F: Object.freeze({ shPct: 0.1305, sog60: 6.7017, ppPts: 0.1206, evToi: 12.9073, ppToi: 1.5813, shToi: 0.7945, ppShare: 0.1035, blocks: 0.5036, hits: 1.2134, pts60: 2.072, shifts: 19.2262 }),
  D: Object.freeze({ shPct: 0.0609, sog60: 3.9734, ppPts: 0.0616, evToi: 16.9942, ppToi: 0.8867, shToi: 1.6145, ppShare: 0.0455, blocks: 1.3691, hits: 0.9812, pts60: 1.086, shifts: 23.6934 }),
  C: Object.freeze({ foPct: 0.5095 }),
  G: Object.freeze({ svPct: 0.8963, gaa: 2.872, saves: 23.61, sa: 26.35 }),
})

// 'G', 'D' or 'F' from a board row. Faceoff % always compares with centers.
export function nhlBaselineGroup(item) {
  if (item?.position === 'G' || item?.prop === 'Goalie Saves') return 'G'
  if (item?.position === 'D') return 'D'
  return 'F'
}

export function nhlBaseline(id, group) {
  if (id === 'foPct') return NHL_POSITION_BASELINES.C.foPct
  const value = NHL_POSITION_BASELINES[group]?.[id]
  return Number.isFinite(value) ? value : null
}

// Wire NHL into the shared scale (src/playerInsights/strengthScale.js).
// Lower-is-better stats by id and by label.
const NHL_LOWER_LABELS = /\bgaa\b|goals against|giveaways?|\bpim\b|penalty min|opp(onent)?\.? def(ense)? rank/i

export function nhlBaselineLabel(group) {
  const name = { F: 'forward', D: 'defense', C: 'center', G: 'goalie' }[group] || 'league'
  return `${NHL_BASELINE_SEASON} NHL ${name} average`
}

// Published position baseline for an NHL API metric, or null (the shared
// scale then falls back to the player's own season).
export function nhlBaselineProvider(metric, model) {
  const group = metric?.id === 'foPct' ? 'C' : (metric?.baseline?.group || model?.baselineGroup)
  const value = Number.isFinite(metric?.baseline?.value) ? metric.baseline.value : nhlBaseline(metric?.id, group)
  if (!Number.isFinite(value)) return null
  return { value, label: nhlBaselineLabel(group) }
}

export function registerNhlStrengthScale({ registerStatDirection, registerBaselineProvider }) {
  for (const [id, direction] of Object.entries(NHL_STAT_DIRECTIONS)) {
    if (direction === 'lower') registerStatDirection('nhl', id, { lowerIsBetter: true })
  }
  registerStatDirection('nhl', NHL_LOWER_LABELS, { lowerIsBetter: true })
  registerBaselineProvider('nhl', nhlBaselineProvider)
}

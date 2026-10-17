// Legal-approved interim copy for the correlated-props labels.
// The NFL tooltip is the approved sentence. Other sports keep that
// disclaimer and name the sport, so a KBO slip does not say NFL.

export const PAIRS_WELL_LABEL = 'Pairs well · Beta'
export const WORKS_AGAINST_LABEL = 'Works against · Beta'

export const CORRELATION_TOOLTIP_NFL = 'Beta / informational. Based on how these stats have moved together in past NFL games (2021-2026). It\'s a research aid, not a prediction or a guarantee, and it\'s still being tested. Rankings stay on CG Score.'

const SPORT_NAME = {
  kbo: 'KBO',
  wnba: 'WNBA',
  nba: 'NBA',
  nfl: 'NFL',
  nhl: 'NHL',
}

export function correlationTooltip(sport) {
  if (sport === 'nfl') return CORRELATION_TOOLTIP_NFL
  const name = SPORT_NAME[sport] || 'these'
  return `Beta / informational. Based on how these stats have moved together in past ${name} games. It's a research aid, not a prediction or a guarantee, and it's still being tested. Rankings stay on CG Score.`
}

export const SAME_GAME_WARNING = 'Same-game heads-up: PrizePicks lineups need players from at least 2 different teams. Lineups with players from the same team or game may pay a different (often lower) payout than the standard rates. Always check the payout shown in the PrizePicks app before you submit.'

export const FLEX_VARIANCE = 'Correlated picks tend to hit or miss together. That can help a lineup where every pick hits, but makes multiple misses more likely, especially in Flex.'

export const SLIP_BETA_FOOTER = 'CGPropz provides sports data and analysis for entertainment and informational purposes only. Projections and correlation scores are not guarantees. CGPropz is not affiliated with, endorsed by, or sponsored by PrizePicks or Underdog, and does not accept entries or wagers. PrizePicks availability, eligibility ages, and rules vary by state; check PrizePicks\' own rules. 21+ to use CGPropz. Gambling problem? Call 1-800-GAMBLER.'

function teamOf(row) {
  return String(row?.team || '').trim()
}

function opponentOf(row) {
  return String(row?.opponent || '').trim()
}

// Same team, or the two sides of one game. Used only to decide whether the
// approved same-game warning is shown.
export function sharesTeamOrGame(row, other) {
  const team = teamOf(row)
  const otherTeam = teamOf(other)
  if (!team || !otherTeam) return false
  if (team === otherTeam) return true
  const opp = opponentOf(row)
  const otherOpp = opponentOf(other)
  if (otherOpp && team === otherOpp) return true
  if (opp && opp === otherTeam) return true
  return false
}

export function slipSharesTeamOrGame(legs) {
  const list = Array.isArray(legs) ? legs : []
  for (let i = 0; i < list.length; i += 1) {
    for (let j = i + 1; j < list.length; j += 1) {
      if (sharesTeamOrGame(list[i], list[j])) return true
    }
  }
  return false
}

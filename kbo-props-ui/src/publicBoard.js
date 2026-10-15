// Rows for the public landing. They are the same standard-line rows the
// Sports Hub already builds (CG Score, L10, held/OUT filter).
//
// There is no Board QA allowlist in this repo. Nothing drops a player by
// name. Smith-Njigba and Darnold stay on the page when their rows pass the
// same filters as every other player. NHL goal-scorer props are not a board
// stat; a row whose stat says "goal scorer" is still left off.

import { kboHubRows, nflHubRows, nhlHubRows, playableRows, topHitRateRows, topHubRows, wnbaHubRows } from './memberHub.js'
import { kickoffInstant, statusPill } from './nfl/gameCardModel.js'
import { NFL_FREE_PREVIEW_ENABLED } from '../api/_dataAccess.js'

const GOAL_SCORER = /goal\s*scorers?/i

// Null means the site has no verified-name list to apply.
export const BOARD_QA_ALLOWLIST = null

export const PUBLIC_SPORTS = [
  { id: 'nfl', name: 'NFL', sportName: 'Football', props: 'Yards · Receptions · Rush att', ds: 'nfl_projections', dev: 'nfl/projections.json', toRows: nflHubRows, lineups: 'nfl_lineups', lineupsDev: 'nfl/lineups.json' },
  { id: 'kbo', name: 'KBO', sportName: 'Baseball', props: 'Hits · RBIs · Strikeouts', ds: 'prizepicks_props', dev: 'prizepicks_props.json', toRows: kboHubRows },
  { id: 'wnba', name: 'WNBA', sportName: 'Basketball', props: 'Points · Rebounds · PRA', ds: 'wnba_projections_standard', dev: 'wnba/projections_standard.json', toRows: wnbaHubRows, lineups: 'wnba_lineups', lineupsDev: 'wnba/lineups.json' },
  { id: 'nhl', name: 'NHL', sportName: 'Hockey', props: 'Shots · Points · Saves', ds: 'nhl_projections', dev: 'nhl/projections.json', toRows: nhlHubRows, lineups: 'nhl_lineups', lineupsDev: 'nhl/lineups.json' },
]

export function isGoalScorerStat(stat) {
  return GOAL_SCORER.test(String(stat || ''))
}

// Playable standard-line rows with a real CG Score. Goal-scorer stats are out.
// `unavailableNames` is the lineup set the hub already uses.
export function publicBoardRows(rows, unavailableNames, starters) {
  return playableRows(rows, unavailableNames, starters).filter((row) => (
    row?.player
    && row?.stat
    && !isGoalScorerStat(row.stat)
    && Number.isFinite(row.score)
  ))
}

export function publicTopHitRows(rows, limit = 10) {
  return topHitRateRows(publicBoardRows(rows), limit)
}

export function publicSwitcherRows(rows, limit = 6) {
  return topHubRows(publicBoardRows(rows), limit)
}

export function publicLandingIncludesReviews() {
  return false
}

export function slateLabel(rows, now = new Date()) {
  const times = (Array.isArray(rows) ? rows : [])
    .map((row) => Date.parse(row?.start || ''))
    .filter((time) => Number.isFinite(time))
  if (!times.length) return 'Board'
  const clock = now instanceof Date ? now.getTime() : Date.parse(String(now))
  const upcoming = times.filter((time) => !Number.isFinite(clock) || time >= clock)
  const when = new Date((upcoming.length ? Math.min(...upcoming) : Math.min(...times)))
  return when.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', timeZone: 'America/New_York' })
}

export function featuredGame(payload, now = new Date()) {
  const games = Array.isArray(payload) ? payload : (Array.isArray(payload?.games) ? payload.games : [])
  const open = games.filter((game) => game && statusPill(game, now) !== 'FINAL')
  const pool = open.length ? open : games
  return pool.slice().sort((a, b) => {
    const left = kickoffInstant(a)?.getTime()
    const right = kickoffInstant(b)?.getTime()
    return (Number.isFinite(left) ? left : Infinity) - (Number.isFinite(right) ? right : Infinity)
  })[0] || null
}

export function rowsForGame(rows, game) {
  if (!game) return []
  const sides = new Set([game.awayTeam, game.homeTeam, game.away, game.home].filter(Boolean))
  return publicSwitcherRows(
    (Array.isArray(rows) ? rows : []).filter((row) => sides.has(row.team) || sides.has(row.opponent)),
    4,
  )
}

export function publicFaqs() {
  const previewBoards = NFL_FREE_PREVIEW_ENABLED
    ? 'KBO, WNBA, NFL, and NHL'
    : 'KBO, WNBA, and NHL'
  const nflNote = NFL_FREE_PREVIEW_ENABLED
    ? ''
    : ' The NFL free preview is off, so NFL rows are not in that public feed.'
  return [
    {
      q: "What's on the page before you subscribe?",
      a: `You get this page and the public preview of the top lines on the ${previewBoards} boards.${nflNote} All-Access unlocks the full boards.`,
    },
    {
      q: 'Does one login cover every league?',
      a: 'Yes. Weekly, Monthly, Yearly, and Lifetime All-Access unlock KBO, WNBA, NFL, and NHL under one login.',
    },
    {
      q: 'What is CG Score?',
      a: 'CG Score compares our projection with the posted line. 50 means they match. Above 50, the projection is over the line. Below 50, it is under. It measures that gap. It is not a probability that the prop hits.',
    },
    {
      q: 'Can I cancel anytime?',
      a: 'Weekly, Monthly, and Yearly can be cancelled anytime. Access continues until the end of the current period. Lifetime is a one-time purchase. There is no free trial.',
    },
    {
      q: 'Is CGPropz affiliated with a sportsbook?',
      a: 'No. CGPropz is not affiliated with any sportsbook or DFS app. It does not take wagers.',
    },
    {
      q: 'How often is the board updated?',
      a: 'KBO, WNBA, NFL, and NHL boards refresh on their own schedule ahead of first pitch, tip-off, kickoff, and puck drop.',
    },
  ]
}

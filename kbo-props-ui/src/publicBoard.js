// Rows for the public landing. They are the same standard-line rows the
// Sports Hub already builds (CG Score, L10, held/OUT filter).
//
// There is no Board QA allowlist in this repo. Nothing drops a player by
// name. Smith-Njigba and Darnold stay on the page when their rows pass the
// same filters as every other player. NHL goal-scorer props are not a board
// stat; a row whose stat says "goal scorer" is still left off.

import { confirmedGoalieStarters, isNeutralHubRow, kboHubRows, nflHubRows, nhlHubRows, playableRows, topHitRateRows, topHubRows, unavailableFromLineups, wnbaHubRows } from './memberHub.js'
import { LANDING_SPORTS } from './landingSports.js'
import { nbaHubRows } from './memberHub.js'
import { boundCg, cgScore } from './cgScore.js'
import { formatPoints, formatSpread, kickoffInstant, statusPill } from './nfl/gameCardModel.js'
import { publicFaqs } from './publicFaqs.js'

const GOAL_SCORER = /goal\s*scorers?/i

// Null means the site has no verified-name list to apply.
export const BOARD_QA_ALLOWLIST = null

const TO_ROWS = {
  nfl: nflHubRows,
  kbo: kboHubRows,
  wnba: wnbaHubRows,
  nhl: nhlHubRows,
  nba: nbaPublicRows,
}

// NBA public rows score like the NBA board (#297): CG Score bounded 0-100,
// with the unbounded score kept as the tiebreak at the cap.
export function nbaPublicRows(data) {
  return nbaHubRows(data).map((row) => {
    const raw = cgScore(row.projection, row.line, row.stat)
    const score = boundCg(raw)
    return { ...row, score: score == null ? NaN : Number(score), rawScore: raw == null ? NaN : Number(raw) }
  })
}

export const PUBLIC_SPORTS = LANDING_SPORTS.map((sport) => ({
  ...sport,
  toRows: TO_ROWS[sport.id],
}))

export { publicFaqs }

export function rowsFromSnapshot(sportId, data, lineupData) {
  const sport = PUBLIC_SPORTS.find((item) => item.id === sportId)
  if (!sport) return []
  return publicBoardRows(
    sport.toRows(data),
    unavailableFromLineups(sport.id, lineupData),
    confirmedGoalieStarters(lineupData),
  )
}

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

// Homepage #free-top-3: the top standard lines by CG Score (the board and
// ledger score), raw score breaking ties, then board order. Held, pulled and
// removed lines and rows with no score are already out (publicBoardRows), and
// a neutral 50 is no pick. No one-per-player rule, same as the server preview.
export const FREE_TOP_LIMIT = 3

export function publicFreeTopRows(rows, limit = FREE_TOP_LIMIT) {
  const raw = (row) => (Number.isFinite(row.rawScore) ? row.rawScore : -Infinity)
  return publicBoardRows(rows)
    .map((row, index) => ({ row, index }))
    .filter(({ row }) => Number.isFinite(Number(row.line)) && !isNeutralHubRow(row))
    .sort((a, b) => (b.row.score - a.row.score) || (raw(b.row) - raw(a.row)) || (a.index - b.index))
    .slice(0, limit)
    .map(({ row }) => row)
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

// Landing matchup sheet: name the team on the spread (book and CG) the same way
// the game cards do, so a CG pick'em reads "PK" instead of a bare "0.0" next to
// an unlabeled book line. Display only; the projection itself is untouched.
export function matchupMarketText(game) {
  return {
    spread: {
      line: formatSpread(game, game?.spread?.line) ?? '—',
      projection: formatSpread(game, game?.spread?.projection) ?? '—',
    },
    total: {
      line: formatPoints(game?.total?.line),
      projection: formatPoints(game?.total?.projection),
    },
  }
}

export function rowsForGame(rows, game) {
  if (!game) return []
  const sides = new Set([game.awayTeam, game.homeTeam, game.away, game.home].filter(Boolean))
  return publicSwitcherRows(
    (Array.isArray(rows) ? rows : []).filter((row) => sides.has(row.team) || sides.has(row.opponent)),
    4,
  )
}

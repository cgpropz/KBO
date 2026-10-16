// Rows for the public landing. They are the same standard-line rows the
// Sports Hub already builds (CG Score, L10, held/OUT filter).
//
// There is no Board QA allowlist in this repo. Nothing drops a player by
// name. Smith-Njigba and Darnold stay on the page when their rows pass the
// same filters as every other player. NHL goal-scorer props are not a board
// stat; a row whose stat says "goal scorer" is still left off.

import { chartWindowRate } from './hitRateStrip.js'
import { confirmedGoalieStarters, kboHubRows, nflHubRows, nhlHubRows, playableRows, topHitRateRows, topHubRows, unavailableFromLineups, wnbaHubRows } from './memberHub.js'
import { LANDING_SPORTS } from './landingSports.js'
import { kickoffInstant, statusPill } from './nfl/gameCardModel.js'
import { publicFaqs } from './publicFaqs.js'

const GOAL_SCORER = /goal\s*scorers?/i

// Null means the site has no verified-name list to apply.
export const BOARD_QA_ALLOWLIST = null

const TO_ROWS = {
  nfl: nflHubRows,
  kbo: kboHubRows,
  wnba: wnbaHubRows,
  nhl: nhlHubRows,
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

export function publicSwitcherRows(rows, limit = 6) {
  return topHubRows(publicBoardRows(rows), limit)
}

// Last `size` logged games. Recent values are oldest → newest. A shorter log
// is not that window. Pushes leave both the hit count and the denominator.
export function hitWindow(row, size) {
  const recent = Array.isArray(row?.recent) ? row.recent : []
  if (recent.length < size) return null
  const rated = chartWindowRate(recent.slice(-size), row?.line, row?.side)
  if (!rated || !rated.games) return null
  return rated
}

// Highest last-5 hit rate. L10 is attached only when that log is real.
export function publicTopL5Rows(rows, limit = 10) {
  const ranked = publicBoardRows(rows)
    .map((row) => {
      const l5 = hitWindow(row, 5)
      if (!l5) return null
      return { ...row, l5, l10: hitWindow(row, 10) }
    })
    .filter(Boolean)
    .sort((a, b) => (
      (b.l5.rate - a.l5.rate)
      || (b.l5.hits - a.l5.hits)
      || (b.l5.games - a.l5.games)
      || ((Number.isFinite(b.score) ? b.score : -Infinity) - (Number.isFinite(a.score) ? a.score : -Infinity))
      || String(a.player).localeCompare(String(b.player))
      || String(a.stat).localeCompare(String(b.stat))
    ))
  const seen = new Set()
  const out = []
  for (const row of ranked) {
    const key = `${row.player}|${row.stat}|${row.line}|${row.side || ''}`
    if (seen.has(key)) continue
    seen.add(key)
    out.push(row)
    if (out.length >= limit) break
  }
  return out
}

// Highest CG Score on the hero board. Same player can appear on two props.
export function publicPhoneRows(rows, limit = 7) {
  return publicBoardRows(rows)
    .filter((row) => Number.isFinite(Number(row.line)) && Number.isFinite(row.score))
    .sort((a, b) => (
      b.score - a.score
      || String(a.player).localeCompare(String(b.player))
      || String(a.stat).localeCompare(String(b.stat))
    ))
    .slice(0, limit)
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

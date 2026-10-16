// Rows the slip builder will not offer. Started and locked games are already
// underway. OUT, IR, LTIR, scratched, and suspended players cannot be entered.
// NHL Points overs under 0.69 use the same show line as the board.

import { pickHasStarted } from './freeTopPicks.js'
import { rowIsHeldOrOut } from './memberHub.js'
import { pointsOverDisposition } from './nhl/pointsGate.js'

export function slipRowBlocked(row, now = new Date()) {
  if (!row || typeof row !== 'object') return true
  if (pickHasStarted(row, now)) return true
  if (row.locked === true || row.started === true) return true
  if (rowIsHeldOrOut(row)) return true
  return false
}

export function keepSlipRow(row, { now = new Date(), pointsGate = false, player = null } = {}) {
  if (slipRowBlocked(row, now) || (player && slipRowBlocked(player, now))) return false
  if (pointsGate && pointsOverDisposition(row) === 'drop') return false
  return true
}

const DATE_KEYS = ['gameDate', 'game_date', 'gameday', 'start_time', 'startTime', 'start_time_utc', 'date']

export function calendarDay(value, timeZone = 'America/New_York') {
  if (value == null || value === '') return null
  const text = String(value).trim()
  if (/^\d{4}-\d{2}-\d{2}$/.test(text)) return text
  const parsed = Date.parse(text)
  if (!Number.isFinite(parsed)) return null
  return new Intl.DateTimeFormat('en-CA', {
    timeZone, year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(new Date(parsed))
}

export function rowGameDay(row, timeZone = 'America/New_York') {
  if (!row || typeof row !== 'object') return null
  for (const key of DATE_KEYS) {
    const day = calendarDay(row[key], timeZone)
    if (day) return day
  }
  return null
}

// True only when some row carries a game date and that date is `day`.
// A file with no dates, or only older dates, is not today's slate.
export function playsOnDay(rows, day, timeZone = 'America/New_York') {
  const list = Array.isArray(rows) ? rows : []
  for (const row of list) {
    if (rowGameDay(row, timeZone) === day) return true
    const props = row?.ppAllProps || row?.props
    if (!Array.isArray(props)) continue
    for (const prop of props) {
      if (rowGameDay(prop, timeZone) === day) return true
    }
  }
  return false
}

export function kboBoardIsOpen(board) {
  return Array.isArray(board?.cards) && board.cards.length > 0
}

export function kboEmptyState(nextGame) {
  const matchup = nextGame?.away && nextGame?.home ? `${nextGame.away} @ ${nextGame.home}` : ''
  const when = nextGame?.label_et || ''
  return {
    title: 'No upcoming props',
    detail: when
      ? `Next game${matchup ? ` · ${matchup}` : ''} · ${when}`
      : 'The next KBO game is not posted yet.',
  }
}

export function wnbaEmptyState() {
  return {
    title: 'No games today',
    detail: 'There is no WNBA game today, so there are no lines to build.',
  }
}

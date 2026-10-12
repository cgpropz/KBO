/*
 * Display rules for the NFL game-market card.
 *
 * The page itself never marked a game as a play. The only cutoff already
 * written down is in nfl/game_markets.py MODEL.summary: a side the model
 * "liked by at least a point" against the close. One point of absolute
 * edge is that cutoff, for the tint and for play / no play.
 *
 * Win probability, the bar, the word "edge", "Lean …", the green/red
 * tile tint, and play / no play stay behind GAME_CARD_PROBS_ENABLED.
 * It defaults off. With the flag off the two numbers sit side by side
 * in neutral styling and the footer is "CG number vs the book".
 *
 * Book line and model projection share one sign: the away spread.
 * Negative means the away team is favored. Each tile names the
 * favored team and shows that team's negative number.
 */

export const GAME_CARD_PROBS_ENABLED = false
export const PLAY_EDGE_POINTS = 1

export function finite(value) {
  if (value == null || value === '') return null
  const number = Number(value)
  return Number.isFinite(number) ? number : null
}

export function formatPoints(value, signed = false) {
  const number = finite(value)
  if (number == null) return '—'
  const text = number.toFixed(1)
  if (!signed) return text
  return number > 0 ? `+${text}` : text
}

export function formatEdge(value) {
  const number = finite(value)
  if (number == null) return '—'
  return `${number > 0 ? '+' : ''}${number.toFixed(1)}`
}

export function kickoffLabel(game) {
  const [hourText, minute] = String(game?.gametime || '').split(':')
  const hour = Number(hourText)
  if (!Number.isFinite(hour)) return game?.weekday || 'Kickoff TBD'
  const meridiem = hour >= 12 ? 'PM' : 'AM'
  const day = game?.weekday ? game.weekday.slice(0, 3).toUpperCase() : ''
  return `${day} ${hour % 12 || 12}:${minute || '00'} ${meridiem} ET`.trim()
}

const LIVE_STATES = new Set(['live', 'in progress', 'in_progress', 'inprogress', 'status_in_progress'])
const FINAL_STATES = new Set(['final', 'post', 'status_final', 'completed', 'complete', 'closed'])

function tzOffsetMs(date, timeZone) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(date)
  const map = {}
  for (const part of parts) map[part.type] = part.value
  const asUtc = Date.UTC(+map.year, +map.month - 1, +map.day, +map.hour % 24, +map.minute, +map.second)
  return asUtc - date.getTime()
}

export function kickoffInstant(game) {
  const day = String(game?.gameday || '')
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) return null
  const [hourText, minuteText = '0'] = String(game?.gametime || '').split(':')
  const hour = Number(hourText)
  const minute = Number(minuteText || '0')
  if (!Number.isFinite(hour) || !Number.isFinite(minute)) return null
  const utcGuess = Date.UTC(+day.slice(0, 4), +day.slice(5, 7) - 1, +day.slice(8, 10), hour, minute, 0)
  const offset = tzOffsetMs(new Date(utcGuess), 'America/New_York')
  let instant = utcGuess - offset
  const offset2 = tzOffsetMs(new Date(instant), 'America/New_York')
  if (offset2 !== offset) instant = utcGuess - offset2
  return new Date(instant)
}

export function statusPill(game, now = new Date()) {
  const raw = game?.status ?? game?.gameStatus ?? game?.state ?? ''
  const text = String(raw).trim().toLowerCase().replace(/\s+/g, ' ')
  if (LIVE_STATES.has(text) || game?.live === true) return 'LIVE'
  if (FINAL_STATES.has(text) || game?.final === true || game?.completed === true) return 'FINAL'
  const kickoff = kickoffInstant(game)
  const clock = now instanceof Date ? now : new Date(now)
  if (kickoff && Number.isFinite(clock.getTime()) && clock.getTime() >= kickoff.getTime()) return 'LIVE'
  return kickoffLabel(game)
}

export function scoreText(value) {
  const number = finite(value)
  if (number == null) return '—'
  return String(Math.round(number))
}

export function scoreLine(scores) {
  if (!scores) return null
  return `${scoreText(scores.away)} – ${scoreText(scores.home)}`
}

export function formatSpread(game, value) {
  const number = finite(value)
  if (number == null) return null
  if (number === 0) return 'PK'
  const awayFavored = number < 0
  const team = awayFavored ? game?.awayTeam : game?.homeTeam
  const shown = awayFavored ? number : -number
  return team ? `${team} ${formatPoints(shown, true)}` : formatPoints(shown, true)
}

function hasProjectedFields(game) {
  return game != null && (
    Object.prototype.hasOwnProperty.call(game, 'projectedAwayScore')
    || Object.prototype.hasOwnProperty.call(game, 'projectedHomeScore')
  )
}

// CG number. Older boards stored that projection in awayScore/homeScore.
// Once the split fields exist, awayScore/homeScore are the actual final.
export function projectedScores(game) {
  const split = hasProjectedFields(game)
  const away = finite(split ? game.projectedAwayScore : game?.awayScore)
  const home = finite(split ? game.projectedHomeScore : game?.homeScore)
  if (away == null && home == null) return null
  return { away, home }
}

export function actualScores(game) {
  if (!hasProjectedFields(game)) return null
  const away = finite(game.awayScore)
  const home = finite(game.homeScore)
  if (away == null || home == null) return null
  return { away, home }
}

export function tileTone(ours, book) {
  const oursNumber = finite(ours)
  const bookNumber = finite(book)
  if (oursNumber == null || bookNumber == null) return ''
  const diff = oursNumber - bookNumber
  if (Math.abs(diff) < PLAY_EDGE_POINTS) return ''
  return diff < 0 ? 'under' : 'over'
}

function absEdge(value) {
  const number = finite(value)
  return number == null ? null : Math.abs(number)
}

export function isPlay(game, hideTotalEdge = false) {
  const spread = absEdge(game?.spread?.edge)
  const total = hideTotalEdge ? null : absEdge(game?.total?.edge)
  return (spread != null && spread >= PLAY_EDGE_POINTS) || (total != null && total >= PLAY_EDGE_POINTS)
}

function spreadLean(game) {
  const edge = finite(game?.spread?.edge)
  const line = finite(game?.spread?.line)
  if (edge == null || line == null || Math.abs(edge) < PLAY_EDGE_POINTS) return null
  const awaySide = edge > 0
  const team = awaySide ? game.awayTeam : game.homeTeam
  const sideLine = awaySide ? line : -line
  if (!team) return null
  return { label: `Lean ${team} ${formatPoints(sideLine, true)}`, edge: Math.abs(edge) }
}

function totalLean(game) {
  const edge = finite(game?.total?.edge)
  const line = finite(game?.total?.line)
  if (edge == null || line == null || Math.abs(edge) < PLAY_EDGE_POINTS) return null
  const side = edge > 0 ? 'Over' : 'Under'
  return { label: `Lean ${side} ${formatPoints(line)}`, edge: Math.abs(edge) }
}

export function leanDetail(game, hideTotalEdge = false) {
  const spread = spreadLean(game)
  const total = hideTotalEdge ? null : totalLean(game)
  if (!spread && !total) return null
  if (!total) return spread
  if (!spread) return total
  return spread.edge >= total.edge ? spread : total
}

export function footerLine(game, probsEnabled, hideTotalEdge = false) {
  if (!probsEnabled) return 'CG number vs the book'
  const play = isPlay(game, hideTotalEdge) ? 'play' : 'no play'
  const lean = leanDetail(game, hideTotalEdge)
  if (!lean) return `CG number vs the book · ${play}`
  return `${lean.label} · edge ${formatEdge(lean.edge)} · ${play}`
}

export function winSplit(game) {
  const home = finite(game?.moneyline?.modelProbability)
  if (home == null || home < 0 || home > 1) return null
  const homePct = Math.round(home * 100)
  return { awayPct: 100 - homePct, homePct }
}

export function cardView(game, probsEnabled = GAME_CARD_PROBS_ENABLED, now = new Date(), options = {}) {
  const hideTotalEdge = options.hideTotalEdge === true
  const scores = projectedScores(game)
  const actuals = actualScores(game)
  return {
    away: game?.awayTeam || '',
    home: game?.homeTeam || '',
    status: statusPill(game, now),
    scores,
    scoreLine: scoreLine(scores),
    actualScores: actuals,
    actualScoreLine: scoreLine(actuals),
    wins: probsEnabled ? winSplit(game) : null,
    spreadBook: formatSpread(game, game?.spread?.line) ?? '—',
    spreadOurs: formatSpread(game, game?.spread?.projection) ?? '—',
    spreadBookMissing: finite(game?.spread?.line) == null,
    spreadTone: probsEnabled ? tileTone(game?.spread?.projection, game?.spread?.line) : '',
    totalBook: formatPoints(game?.total?.line),
    totalOurs: formatPoints(game?.total?.projection),
    totalBookMissing: finite(game?.total?.line) == null,
    totalTone: probsEnabled && !hideTotalEdge ? tileTone(game?.total?.projection, game?.total?.line) : '',
    footer: footerLine(game, probsEnabled, hideTotalEdge),
  }
}

export function edgeRank(game, options = {}) {
  const includeTotal = options.includeTotal !== false
  const edges = [game?.spread?.edge, includeTotal ? game?.total?.edge : null].map(absEdge).filter((value) => value != null)
  return edges.length ? Math.max(...edges) : null
}

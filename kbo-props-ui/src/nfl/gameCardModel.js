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
 * in neutral styling and the footer is "Our number vs the book".
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

export function statusPill(game) {
  const raw = game?.status ?? game?.gameStatus ?? game?.state ?? ''
  const text = String(raw).trim().toLowerCase().replace(/\s+/g, ' ')
  if (['live', 'in progress', 'in_progress', 'inprogress', 'status_in_progress'].includes(text)) return 'LIVE'
  if (['final', 'post', 'status_final'].includes(text)) return 'FINAL'
  return kickoffLabel(game)
}

export function scoreText(value) {
  const number = finite(value)
  if (number == null) return '—'
  return String(Math.round(number))
}

export function projectedScores(game) {
  const away = finite(game?.awayScore)
  const home = finite(game?.homeScore)
  if (away == null && home == null) return null
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

export function isPlay(game) {
  const spread = absEdge(game?.spread?.edge)
  const total = absEdge(game?.total?.edge)
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

export function leanDetail(game) {
  const spread = spreadLean(game)
  const total = totalLean(game)
  if (!spread && !total) return null
  if (!total) return spread
  if (!spread) return total
  return spread.edge >= total.edge ? spread : total
}

export function footerLine(game, probsEnabled) {
  if (!probsEnabled) return 'Our number vs the book'
  const play = isPlay(game) ? 'play' : 'no play'
  const lean = leanDetail(game)
  if (!lean) return `Our number vs the book · ${play}`
  return `${lean.label} · edge ${formatEdge(lean.edge)} · ${play}`
}

export function winSplit(game) {
  const home = finite(game?.moneyline?.modelProbability)
  if (home == null || home < 0 || home > 1) return null
  const homePct = Math.round(home * 100)
  return { awayPct: 100 - homePct, homePct }
}

export function cardView(game, probsEnabled = GAME_CARD_PROBS_ENABLED) {
  const scores = projectedScores(game)
  return {
    away: game?.awayTeam || '',
    home: game?.homeTeam || '',
    status: statusPill(game),
    scores,
    wins: probsEnabled ? winSplit(game) : null,
    spreadBook: formatPoints(game?.spread?.line, true),
    spreadOurs: formatPoints(game?.spread?.projection, true),
    spreadTone: probsEnabled ? tileTone(game?.spread?.projection, game?.spread?.line) : '',
    totalBook: formatPoints(game?.total?.line),
    totalOurs: formatPoints(game?.total?.projection),
    totalTone: probsEnabled ? tileTone(game?.total?.projection, game?.total?.line) : '',
    footer: footerLine(game, probsEnabled),
  }
}

export function edgeRank(game) {
  const edges = [game?.spread?.edge, game?.total?.edge].map(absEdge).filter((value) => value != null)
  return edges.length ? Math.max(...edges) : null
}

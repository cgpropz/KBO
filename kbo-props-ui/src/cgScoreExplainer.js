import { lineResult } from './hitRateStrip.js'
import { NFL_LINE_FLOORS } from './nfl/nflLineFloors.js'
import { displayScore } from './sideRank.js'

// Approved CG Score note (Code Green, Oct 11). Fill the variables the board
// already has. Leave a clause out when that variable is not on the row.
// Never add a model probability.

const RECENT_WINDOW = 10
const NAME_SUFFIX = /^(jr|sr|ii|iii|iv|v)\.?$/i
const MIDDLE_CAP_STATS = new Set(['Receiving Yards', 'Rush Yards'])

const DISCLAIMER = 'Projections are estimates, not guarantees. 21+ · Play responsibly · Entertainment only · 1-800-GAMBLER'

export function formatStatNumber(value) {
  const number = Number(value)
  if (!Number.isFinite(number)) return null
  const hundredths = Math.round(number * 100) / 100
  const tenths = Math.round(number * 10) / 10
  if (Math.abs(hundredths - tenths) > 1e-9) return hundredths.toFixed(2)
  if (Number.isInteger(tenths)) return String(tenths)
  return tenths.toFixed(1)
}

export function formatScoreNumber(value) {
  const number = Number(value)
  if (!Number.isFinite(number)) return null
  return number.toFixed(1)
}

export function playerLastName(name) {
  const parts = String(name || '').trim().split(/\s+/).filter(Boolean)
  while (parts.length > 1 && NAME_SUFFIX.test(parts[parts.length - 1])) parts.pop()
  return parts.length ? parts[parts.length - 1] : null
}

export function projectionSide(projection, line) {
  const projected = Number(projection)
  const posted = Number(line)
  if (!Number.isFinite(projected) || !Number.isFinite(posted)) return null
  if (projected > posted) return 'over'
  if (projected < posted) return 'under'
  return null
}

// The Middle cap changed the score only for receiving yards under 15.5 and
// rush yards under 18.5, and only when that floor actually moves the ratio.
export function nflMiddleCapChanged(stat, projection, line) {
  if (!MIDDLE_CAP_STATS.has(stat)) return false
  const floor = NFL_LINE_FLOORS[stat]
  const projected = Number(projection)
  const posted = Number(line)
  if (!Number.isFinite(floor) || !Number.isFinite(projected) || !(posted > 0) || !(posted < floor)) return false
  return (projected / posted) * 50 !== (projected / floor) * 50
}

export function recentWindow(values, { newestFirst = false, size = RECENT_WINDOW } = {}) {
  const list = Array.isArray(values) ? values : []
  return newestFirst ? list.slice(0, size) : list.slice(-size)
}

// seasons is one label per game in the projection window, same order as that window.
// Returns '' when every game is the current season, the parenthetical when they
// are not, or null when the split cannot be read.
export function seasonNote(seasons, currentSeason) {
  if (!Array.isArray(seasons) || !seasons.length) return null
  const labels = seasons.map((season) => (season == null || season === '' ? null : String(season)))
  if (labels.some((season) => season == null)) return null
  if (currentSeason == null || currentSeason === '') return null
  const current = String(currentSeason)
  const prior = labels.filter((season) => season !== current)
  if (!prior.length) return ''
  const distinct = [...new Set(prior)]
  if (distinct.length !== 1) return null
  return ` (${prior.length} from ${distinct[0]})`
}

function basedOnClause(player, projectionGames, currentSeason) {
  if (!Array.isArray(projectionGames) || !projectionGames.length) return ''
  const last = playerLastName(player)
  if (!last) return ''
  const note = seasonNote(projectionGames, currentSeason)
  const season = note == null ? '' : note
  return `, based on ${last}'s last ${projectionGames.length} games${season}`
}

function recentRecordSentence(values, line, side) {
  let hits = 0
  let pushes = 0
  let games = 0
  for (const value of values) {
    const result = lineResult(value, line)
    if (result == null) continue
    games += 1
    if (result === 'push') pushes += 1
    else if (side && ((side === 'over' && result === 'hit') || (side === 'under' && result === 'miss'))) hits += 1
  }
  const pushNote = pushes > 0 ? ` (${pushes} pushed)` : ''
  if (!side) {
    return {
      sentence: `Recent record: projection is right on the line, so no side is favored${pushNote}.`,
      games,
    }
  }
  if (!games) return { sentence: null, games: 0 }
  return {
    sentence: `Recent record: ${hits} of the last ${games} went ${side} this line${pushNote}.`,
    games,
  }
}

export function buildCgScoreExplainer({
  player,
  projection,
  line,
  stat,
  score,
  recentValues,
  newestFirst = false,
  projectionGames = null,
  currentSeason = null,
  symmetric = false,
} = {}) {
  const side = projectionSide(projection, line)
  // Symmetric preview: an under reads as its same-side strength with the
  // side named, so it matches the board cell. The score itself is unchanged.
  const shown = symmetric && side === 'under' && Number.isFinite(Number(score)) ? displayScore(score, 'UNDER') : score
  const scoreText = formatScoreNumber(shown)
  const projText = formatStatNumber(projection)
  const lineText = formatStatNumber(line)
  if (scoreText == null || projText == null || lineText == null) return null

  const window = recentWindow(recentValues, { newestFirst })
  const record = recentRecordSentence(window, line, side)
  const lead = `Our projection is ${projText} against a line of ${lineText}${basedOnClause(player, projectionGames, currentSeason)}.`

  return {
    score: scoreText,
    sideLabel: symmetric && side ? (side === 'under' ? 'Under' : 'Over') : null,
    lead,
    recent: record.sentence,
    smallSample: record.games > 0 && record.games < 8,
    capped: nflMiddleCapChanged(stat, projection, line),
    disclaimer: DISCLAIMER,
  }
}

export function explainerText(note) {
  if (!note) return ''
  const lines = [`CG Score ${note.score}${note.sideLabel ? ` ${note.sideLabel}` : ''}. ${note.lead}`]
  if (note.recent) lines.push(note.recent)
  if (note.smallSample) lines.push('Small sample, so give this less weight.')
  if (note.capped) lines.push('Scores on very small lines are adjusted.')
  lines.push(note.disclaimer)
  return lines.join('\n')
}

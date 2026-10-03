/**
 * Short reason for a board rating.
 * Every line comes from resolveSpec() plus numbers already on the row.
 * Hit rate is a separate column. It is not an input to the rating.
 */

import { resolveSpec } from './formulaModel.js'

function num(value) {
  const n = Number(value)
  return Number.isFinite(n) ? n : null
}

function pickNum(row, keys) {
  for (const key of keys) {
    const value = row?.[key]
    if (value == null || value === '') continue
    const n = num(value)
    if (n != null) return n
  }
  return null
}

function one(value) {
  return num(value).toFixed(1)
}

function two(value) {
  return num(value).toFixed(2)
}

function pct(value) {
  return `${Math.round(num(value))}%`
}

function weightText(weights) {
  return weights.map((weight) => `${Math.round(weight * 100)}%`).join(', ').replace(/, ([^,]+)$/, ', and $1')
}

function propPhrase(prop) {
  const text = String(prop || 'this prop')
  if (text === 'Hits+Runs+RBIs') return 'hits, runs, and RBI'
  return text.toLowerCase()
}

function subject(row) {
  return String(row?.name || row?.player || '').trim()
}

function ratingFacts(row) {
  const projection = pickNum(row, ['projection'])
  const line = pickNum(row, ['line'])
  let rating = pickNum(row, ['rating', 'score'])
  if (rating == null && projection != null && line != null && line > 0) {
    rating = Number(((projection / line) * 50).toFixed(1))
  }
  if (rating == null || projection == null || line == null || line <= 0) return null
  const gap = projection - line
  let side = 'Push'
  if (gap > 0.0001) side = 'Over'
  else if (gap < -0.0001) side = 'Under'
  return { projection, line, rating, gap, side }
}

function nearOne(value) {
  const n = num(value)
  return n != null && Math.abs(n - 1) < 0.005
}

function cap(text) {
  return text.charAt(0).toUpperCase() + text.slice(1)
}

function listJoin(items) {
  const parts = items.filter(Boolean)
  if (parts.length <= 1) return parts[0] || ''
  if (parts.length === 2) return `${parts[0]} and ${parts[1]}`
  return `${parts.slice(0, -1).join(', ')}, and ${parts[parts.length - 1]}`
}

function longTrackRecord(weights) {
  if (!weights || weights.length < 3) return false
  const longest = Math.max(...weights)
  return weights[0] <= 0.2 && longest >= 0.5 && longest === weights[weights.length - 1]
}

function decisionLine(facts, scoreLabel) {
  const label = scoreLabel === 'score' ? 'Score' : 'Rating'
  if (facts.side === 'Push') {
    return `Push. ${label} ${one(facts.rating)} because the projection (${one(facts.projection)}) matches the line.`
  }
  const lean = facts.side === 'Over' ? 'Leans Over' : 'Leans Under'
  const direction = facts.side === 'Over' ? 'above' : 'below'
  return `${lean}. ${label} ${one(facts.rating)} because the projection (${one(facts.projection)}) is ${one(Math.abs(facts.gap))} ${direction} the line.`
}

function hitLine(row, facts, scoreLabel) {
  const l5 = pickNum(row, ['hit_rate_l5', 'hitRateL5'])
  if (l5 == null) return ''
  const disagrees = (facts.side === 'Over' && l5 < 50) || (facts.side === 'Under' && l5 > 50)
  if (!disagrees) return ''
  const label = scoreLabel === 'score' ? 'score' : 'rating'
  return `Last 5 cleared the line ${pct(l5)} of the time. That hit rate does not set the ${label}.`
}

function weightPhrase(weights, labels) {
  const parts = weights.map((weight, index) => `${Math.round(weight * 100)}% ${labels[index]}`)
  return listJoin(parts)
}

function pitcherWeightLine(spec) {
  const text = weightPhrase(spec.weights, ['recent starts', 'this season', 'all starts'])
  if (longTrackRecord(spec.weights)) return `Most of the weight is the longer record: ${text}.`
  return `Weight is ${text}.`
}

function moveWord(factor) {
  const n = num(factor)
  if (n == null || nearOne(n)) return ''
  return n > 1 ? 'raises' : 'lowers'
}

function opponentLine(spec, row) {
  if (!spec?.opponent) return ''
  const move = moveWord(row.opp_factor)
  const tail = move ? `, which ${move} it` : ''
  if (spec.opponent === 'strikeouts') {
    const opp = num(row.opp_so_per_g)
    const league = num(row.league_avg_so_per_g)
    const who = row.opponent || 'The opponent'
    if (opp != null && league != null) {
      return `${who} strikes out ${one(opp)} times a game, versus ${one(league)} in the league${tail}.`
    }
    return move ? `The opponent's strikeouts per game ${move} it.` : ''
  }
  if (spec.opponent === 'hits') {
    const opp = num(row.opp_h_per_ip)
    const league = num(row.league_avg_h_per_ip)
    const who = row.opponent || 'The opponent'
    if (opp != null && league != null) {
      return `${who} hits ${two(opp)} per inning, versus ${two(league)} in the league${tail}.`
    }
    return move ? `Opponent hits per inning ${move} it.` : ''
  }
  if (spec.opponent === 'outs') {
    const opp = num(row.opp_h_per_ip)
    const league = num(row.league_avg_h_per_ip)
    if (opp != null && league != null) {
      const who = row.opponent || 'The opponent'
      return `${who} hits ${two(opp)} per inning, versus ${two(league)}. More hits mean fewer outs.`
    }
    return 'More opponent hits mean fewer outs.'
  }
  if (spec.opponent === 'corrected') {
    const verb = move === 'raises' ? 'raise' : 'lower'
    return move ? `Opponent pitchers ${verb} it (${two(row.opp_factor)}).` : ''
  }
  if (spec.opponent === 'published' || spec.opponent === true) {
    return move ? `The opponent ${move} it (${two(row.opp_factor)}).` : (spec.opponent === true ? '' : '')
  }
  return ''
}

function formLine(spec, row) {
  if (!spec?.form) return ''
  const factor = num(row.form_factor)
  const move = moveWord(factor)
  if (!move) return ''
  return `Recent form multiplies the projection by ${two(factor)}.`
}

function scaleLine(spec, row) {
  const parts = []
  if (spec.park && moveWord(row.park_factor)) parts.push('the park')
  if (spec.split && moveWord(row.split_factor)) parts.push('handedness')
  if (spec.pitcher && moveWord(row.pitcher_factor)) parts.push('pitcher WHIP')
  if (!parts.length) return ''
  return `${cap(listJoin(parts))} also moves it.`
}

function contextLines(spec, row) {
  if (!spec) return []
  if (spec.kind === 'pitcher') {
    const weight = spec.timesThree ? `Outs are innings per start times 3. ${pitcherWeightLine(spec)}` : pitcherWeightLine(spec)
    return [weight, opponentLine(spec, row), formLine(spec, row)]
  }
  if (spec.kind === 'hrr') {
    const weight = longTrackRecord(spec.rateWeights) || longTrackRecord(spec.paWeights)
      ? 'Most of the weight is the season.'
      : `Plate appearances are ${weightPhrase(spec.paWeights, ['last 3', 'last 6', 'the season'])}.`
    return [weight, opponentLine(spec, row), scaleLine(spec, row)]
  }
  if (spec.kind === 'tb') {
    return ['Total bases blend the last 5, last 10, and the season, then the opponent, park, handedness, and pitcher WHIP.']
  }
  if (spec.kind === 'fantasy') {
    return ['Fantasy score mixes recent games with the season, then opponent, park, handedness, and pitcher WHIP.']
  }
  if (spec.kind === 'wnba') {
    const [a, b, c] = spec.windows
    const weights = weightText(spec.weights)
    const defense = spec.dvp === 'half'
      ? ' Defense is a mild adjustment.'
      : spec.dvp === 'on'
        ? ' Opponent defense is included.'
        : ''
    return [`Per minute is ${weights} on the last ${a}, ${b}, and ${c} games. Minutes are the last ${spec.minutes}.${defense}`]
  }
  if (spec.kind === 'nfl') {
    const [a, b, c] = spec.windows
    const weights = weightText(spec.weights)
    const capNote = spec.cap < c ? ` Only the last ${spec.cap} games are kept.` : ''
    return [`Weight is ${weights} on the last ${a}, last ${b}, and last ${c} games.${capNote}`]
  }
  return []
}

export function explainProp(row) {
  const facts = ratingFacts(row || {})
  const scoreLabel = row?.scoreLabel === 'score' ? 'score' : 'rating'
  if (!facts) {
    return {
      title: `Why this ${scoreLabel}`,
      side: 'Push',
      rating: '',
      headline: '',
      lines: ['This row does not have both a projection and a line.'],
      paragraphs: ['This row does not have both a projection and a line.'],
    }
  }
  const spec = resolveSpec({ ...row, scoreLabel })
  const lines = [
    decisionLine(facts, scoreLabel),
    hitLine({ ...row, scoreLabel }, facts, scoreLabel),
    ...contextLines(spec, row),
  ].filter(Boolean)
  const prop = propPhrase(row.prop || row.stat)
  return {
    title: `Why this ${scoreLabel} is ${one(facts.rating)}`,
    side: facts.side,
    rating: one(facts.rating),
    headline: `${one(facts.line)} ${prop}`,
    lines,
    paragraphs: lines,
  }
}

export function boardFormulaLine(sport, prop) {
  const spec = resolveSpec({ sport, prop })
  if (!spec) return 'Open a row to see why that rating was given.'
  if (spec.kind === 'pitcher') {
    const weights = weightText(spec.weights)
    const opp = spec.opponent === 'strikeouts'
      ? ' Times the opponent\'s strikeouts per game versus the league.'
      : spec.opponent === 'hits'
        ? ' Times the opponent\'s hits per inning versus the league.'
        : spec.opponent === 'outs'
          ? ' Times how many hits the opponent collects per inning.'
          : ''
    if (spec.timesThree) {
      return `Innings per start × 3, weighted ${weights} on recent starts, this season, and all starts.${opp}`
    }
    return `${cap(spec.rateLabel)} × innings per start, weighted ${weights} on recent starts, this season, and all starts.${opp}`
  }
  if (spec.kind === 'hrr') {
    const opp = spec.opponent === 'corrected'
      ? ' Scaled by the opponent\'s pitchers.'
      : spec.opponent === 'published'
        ? ' Scaled by the opponent\'s own hits, runs, and RBI per game.'
        : ''
    return `Plate appearances (${weightText(spec.paWeights)}) times hit, run, and RBI rates (${weightText(spec.rateWeights)}).${opp}`
  }
  if (spec.kind === 'tb') {
    return 'Total bases per game, blended from the last 5, last 10, and the season, times opponent total bases, the park, handedness, and pitcher WHIP.'
  }
  if (spec.kind === 'fantasy') {
    return 'Fantasy points from the box score, scaled by opponent, park, handedness, and pitcher WHIP.'
  }
  if (spec.kind === 'wnba') {
    const [a, b, c] = spec.windows
    const defense = spec.dvp === 'off' ? '' : spec.dvp === 'half' ? ' Defense is a mild adjustment.' : ' Defense against this position is included.'
    return `Per-minute production over the last ${a}, ${b}, and ${c} games (${weightText(spec.weights)}), times minutes from the last ${spec.minutes}.${defense}`
  }
  if (spec.kind === 'nfl') {
    const [a, b, c] = spec.windows
    return `Last ${a}, ${b}, and ${c} games at ${weightText(spec.weights)}, using the most recent ${spec.cap} games.`
  }
  return 'Open a row to see why that rating was given.'
}

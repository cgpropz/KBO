/**
 * Plain-language reason for a board rating.
 * Every sentence comes from resolveSpec() plus numbers already on the row.
 * Hit rate is described only as a separate column. It is not an input to the rating.
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

function weightAcross(weights, labels) {
  const parts = weights.map((weight, index) => `${Math.round(weight * 100)}% on ${labels[index]}`)
  if (parts.length === 1) return parts[0]
  if (parts.length === 2) return `${parts[0]} and ${parts[1]}`
  return `${parts.slice(0, -1).join(', ')}, and ${parts[parts.length - 1]}`
}

function propPhrase(prop) {
  const text = String(prop || 'this prop')
  if (text === 'Hits+Runs+RBIs') return 'hits, runs, and RBI'
  return text.toLowerCase()
}

function calibrationSentence(cal, happened) {
  if (!cal) return ''
  return ` Before it is published, that raw total is adjusted to ${cal[0]} + ${cal[1]} × the raw total, so it sits closer to ${happened}.`
}

function subject(row, fallback) {
  const name = String(row?.name || row?.player || '').trim()
  return name || fallback
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

function ratingParagraph(row, facts, scoreLabel) {
  const who = subject(row, 'This prop')
  const prop = propPhrase(row.prop || row.stat)
  const label = scoreLabel === 'score' ? 'score' : 'rating'
  if (facts.side === 'Push') {
    return `The ${one(facts.rating)} ${label} on ${who} is a push at ${one(facts.line)} ${prop}. A ${label} of 50 means the projection matches the line, and here the projection is ${one(facts.projection)}.`
  }
  const direction = facts.side === 'Over' ? 'above' : 'below'
  const lean = facts.side === 'Over' ? 'higher' : 'lower'
  const variance = scoreLabel === 'rating' ? ' That gap is the Variance column.' : ''
  return `The ${one(facts.rating)} ${label} on ${who} leans ${facts.side} ${one(facts.line)} ${prop}. A ${label} of 50 would mean the projection matches the line. This one is ${lean} because the projection (${one(facts.projection)}) is ${one(Math.abs(facts.gap))} ${direction} that line.${variance}`
}

function nearOne(value) {
  const n = num(value)
  return n != null && Math.abs(n - 1) < 0.005
}

function factorClause(label, value, raises, lowers) {
  const n = num(value)
  if (n == null) return null
  if (nearOne(n)) return `${label} is ${two(n)}, so it does not move the projection.`
  return `${label} is ${two(n)}, which ${n > 1 ? raises : lowers}.`
}

function withMultiplier(lead, value, raises, lowers) {
  const n = num(value)
  const sentence = lead.endsWith('.') ? lead : `${lead}.`
  if (n == null) return sentence
  if (nearOne(n)) return `${sentence} The multiplier on this row is ${two(n)}, so it does not move the projection.`
  return `${sentence} The multiplier on this row is ${two(n)}, which ${n > 1 ? raises : lowers}.`
}

function joinSentences(parts) {
  return parts.filter(Boolean).join(' ')
}

function pitcherParagraph(spec, row) {
  const weights = weightAcross(spec.weights, [spec.timesThree ? spec.countWindow : spec.rateWindow, 'this season', 'all starts'])
  const inningWeights = weightAcross(spec.weights, [spec.countWindow, 'this season', 'all starts'])
  const depth = spec.timesThree
    ? `Expected outs are innings per start times 3. Innings per start are ${weights}.`
    : `The projection is expected ${spec.statLabel}: ${spec.rateLabel} times innings per start. ${cap(spec.rateLabel)} are ${weights}. Innings per start are ${inningWeights}.`
  const shrink = `The pitcher's own rate fully replaces the league average after ${spec.shrink} starts. Fewer starts stay closer to the league.`
  const opponent = opponentSentence(spec, row)
  const form = formSentence(spec, row)
  const cal = calibrationSentence(spec.cal, `how ${spec.statLabel} have actually landed`)
  return joinSentences([depth, shrink, opponent, form]) + cal
}

function cap(text) {
  return text.charAt(0).toUpperCase() + text.slice(1)
}

function opponentSentence(spec, row) {
  if (!spec.opponent) return ''
  const factor = factorClause(
    'That matchup multiplier',
    row.opp_factor,
    'raises the projection',
    'lowers the projection',
  )
  if (spec.opponent === 'strikeouts') {
    const opp = num(row.opp_so_per_g)
    const league = num(row.league_avg_so_per_g)
    const who = row.opponent ? `${row.opponent}` : 'The opponent'
    const rates = opp != null && league != null
      ? `${who} strikes out ${one(opp)} times a game, against a league average of ${one(league)}.`
      : `${who}'s strikeouts per game, compared with the league, move expected strikeouts.`
    return joinSentences([rates, factor || ''])
  }
  if (spec.opponent === 'hits') {
    const opp = num(row.opp_h_per_ip)
    const league = num(row.league_avg_h_per_ip)
    const who = row.opponent ? `${row.opponent}` : 'The opponent'
    const rates = opp != null && league != null
      ? `${who} has been hitting ${two(opp)} hits per inning, against a league average of ${two(league)}.`
      : `How many hits ${who === 'The opponent' ? 'the opponent' : who} collects per inning moves expected hits allowed.`
    return joinSentences([rates, factor || ''])
  }
  if (spec.opponent === 'outs') {
    const opp = num(row.opp_h_per_ip)
    const league = num(row.league_avg_h_per_ip)
    const who = row.opponent ? `${row.opponent}` : 'The opponent'
    const rates = opp != null && league != null
      ? `${who} has been hitting ${two(opp)} hits per inning, against a league average of ${two(league)}. More hits mean a shorter outing and fewer outs.`
      : `How many hits the opponent collects per inning changes the length of the outing. More hits mean fewer outs.`
    return joinSentences([rates, factor || ''])
  }
  return ''
}

function formSentence(spec, row) {
  if (!spec.form) return ''
  const factor = num(row.form_factor)
  const [lo, hi] = spec.form
  if (factor == null) {
    return `Recent production versus the season rate can still multiply the projection, and that multiplier stays between ${lo.toFixed(2)} and ${hi.toFixed(2)}. That is separate from the hit rate.`
  }
  if (nearOne(factor)) {
    return `Recent production matches the season rate (multiplier ${two(factor)}), so it does not push the projection. That multiplier is separate from the hit rate.`
  }
  const way = factor > 1 ? 'above' : 'below'
  return `Recent production is ${way} the season rate, so it multiplies the projection by ${two(factor)}. That multiplier stays between ${lo.toFixed(2)} and ${hi.toFixed(2)}, and it is separate from the hit rate.`
}

function hrrParagraph(spec, row) {
  const base = `Expected hits plus runs plus RBI start from plate appearances (${weightAcross(spec.paWeights, ['the last 3 games', 'the last 6 games', 'the season'])}) times the chance of a hit, a run, and an RBI in each plate appearance (${weightAcross(spec.rateWeights, ['the last 3 games', 'the last 6 games', 'the season'])}).`
  const extras = []
  if (spec.opponent === 'corrected') {
    extras.push(withMultiplier(
      'The opponent\'s pitchers scale that base by how many hits, runs, and RBI they have allowed versus the league',
      row.opp_factor,
      'raises the projection',
      'lowers the projection',
    ))
  } else if (spec.opponent === 'published') {
    extras.push(withMultiplier(
      'The opponent\'s own hits, runs, and RBI per game, compared with the league, scale that base',
      row.opp_factor,
      'raises the projection',
      'lowers the projection',
    ))
  }
  if (spec.park) {
    extras.push(factorClause('The park run factor', row.park_factor, 'raises the projection', 'lowers the projection')
      || 'The park\'s run factor scales the projection.')
  }
  if (spec.split) {
    extras.push(factorClause('The handedness split', row.split_factor, 'raises the projection', 'lowers the projection')
      || 'Batting average against this pitcher\'s throwing hand, compared with the league, scales the projection.')
  }
  if (spec.pitcher) {
    extras.push(factorClause('The opposing pitcher\'s WHIP factor', row.pitcher_factor, 'raises the projection', 'lowers the projection')
      || 'The opposing pitcher\'s WHIP scales the projection.')
  }
  return [base, ...extras].join(' ') + calibrationSentence(spec.cal, 'what hitters have actually produced')
}

function tbParagraph(spec, row) {
  const base = 'Expected total bases per game blend the recent games with the season: 35% of the last 5 and 25% of the last 10 and 40% of the season when at least 10 games are logged, or 40% of the last 5 and 60% of the season when at least 5 games are logged. Shorter logs use the season average.'
  const extras = [
    withMultiplier(
      'The opponent\'s total bases per game versus the league scale that base',
      row.opp_factor,
      'raises the projection',
      'lowers the projection',
    ),
  ]
  if (spec.park) {
    extras.push(factorClause('The park home-run factor', row.park_factor, 'raises the projection', 'lowers the projection')
      || 'The park\'s home-run factor scales the projection.')
  }
  if (spec.split) {
    extras.push(factorClause('The handedness split', row.split_factor, 'raises the projection', 'lowers the projection')
      || 'Batting average against this pitcher\'s throwing hand, compared with the league, scales the projection.')
  }
  if (spec.pitcher) {
    extras.push(factorClause('The opposing pitcher\'s WHIP factor', row.pitcher_factor, 'raises the projection', 'lowers the projection')
      || 'The opposing pitcher\'s WHIP scales the projection.')
  }
  return [base, ...extras].join(' ')
}

function fantasyParagraph(spec, row) {
  const base = `The fantasy projection starts from plate appearances (${weightAcross(spec.paWeights, ['the last 3 games', 'the last 6 games', 'the season'])}) and scoring rates (${weightAcross(spec.rateWeights, ['the last 3 games', 'the last 6 games', 'the season'])}). A single is 3, a double is 5, a triple is 8, a home run is 10, and a run, RBI, walk, hit-by-pitch, and stolen base are 2 each.`
  const extras = []
  if (spec.opponent) {
    extras.push(factorClause('The opponent-offense multiplier', row.opp_factor, 'raises the projection', 'lowers the projection')
      || 'Opponent offense scales the pieces.')
  }
  if (spec.park) {
    extras.push(factorClause('The park multiplier', row.park_factor, 'raises the projection', 'lowers the projection')
      || 'The park scales the pieces.')
  }
  if (spec.split) {
    extras.push(factorClause('The handedness multiplier', row.split_factor, 'raises the projection', 'lowers the projection')
      || 'The handedness split scales the pieces.')
  }
  if (spec.pitcher) {
    extras.push(factorClause('The opposing pitcher\'s WHIP multiplier', row.pitcher_factor, 'raises the projection', 'lowers the projection')
      || 'The opposing pitcher\'s WHIP scales the pieces.')
  }
  return [base, ...extras].join(' ') + calibrationSentence(spec.cal, 'what fantasy scores have actually been')
}

function listWords(items) {
  if (items.length === 1) return items[0]
  if (items.length === 2) return `${items[0]} and ${items[1]}`
  return `${items.slice(0, -1).join(', ')}, and ${items[items.length - 1]}`
}

function wnbaParagraph(spec) {
  const [a, b, c] = spec.windows
  const weights = weightText(spec.weights)
  let production
  if (spec.pieces === 'fantasy') {
    production = `Fantasy score adds points, 1.2 times rebounds, 1.5 times assists, 3 times steals, 3 times blocks, and subtracts turnovers. Each piece is a per-minute rate times expected minutes. Those per-minute rates put ${weights} on the last ${a}, ${b}, and ${c} games.`
  } else if (spec.pieces.length === 1) {
    production = `Expected ${spec.pieces[0]} come from per-minute production times expected minutes. Per-minute production puts ${weights} on the last ${a}, ${b}, and ${c} games.`
  } else {
    production = `${cap(listWords(spec.pieces))} are each projected from per-minute production times expected minutes, then added. Per-minute production puts ${weights} on the last ${a}, ${b}, and ${c} games.`
  }
  const minutes = `Minutes are the average of the last ${spec.minutes} games.`
  let defense = ''
  if (spec.dvp === 'on') defense = 'The opponent\'s defense against this position scales the projection.'
  if (spec.dvp === 'half') defense = 'The opponent\'s defense against this position scales the projection mildly, using the square root of the usual defense factor.'
  return joinSentences([production, minutes, defense]) + calibrationSentence(spec.cal, 'what has actually happened')
}

function nflParagraph(spec) {
  const [a, b, c] = spec.windows
  const weights = weightText(spec.weights)
  const capped = spec.cap < c
    ? ` Only the most recent ${spec.cap} games are kept, so the ${c}-game piece is really the last ${spec.cap}.`
    : ` Only the most recent ${spec.cap} games are kept.`
  const blend = `The projection blends the last ${a} games, the last ${b}, and the last ${c} at ${weights}.${capped}`
  return blend + calibrationSentence(spec.cal, 'what has actually happened')
}

function projectionParagraph(spec, row) {
  if (!spec) return ''
  if (spec.kind === 'pitcher') return pitcherParagraph(spec, row)
  if (spec.kind === 'hrr') return hrrParagraph(spec, row)
  if (spec.kind === 'tb') return tbParagraph(spec, row)
  if (spec.kind === 'fantasy') return fantasyParagraph(spec, row)
  if (spec.kind === 'wnba') return wnbaParagraph(spec)
  if (spec.kind === 'nfl') return nflParagraph(spec)
  return ''
}

function longTrackRecord(spec) {
  if (!spec) return false
  const weights = spec.weights || spec.rateWeights
  if (!weights || weights.length < 3) return false
  const recent = weights[0]
  const longest = Math.max(...weights)
  return recent <= 0.2 && longest >= 0.5 && longest === weights[weights.length - 1]
}

function hitRateParagraph(row, facts, spec) {
  const who = subject(row, 'this player')
  const prop = propPhrase(row.prop || row.stat)
  const l5 = pickNum(row, ['hit_rate_l5', 'hitRateL5'])
  const l10 = pickNum(row, ['hit_rate_l10', 'hitRateL10'])
  const full = pickNum(row, ['hit_rate_full', 'hitRateFull'])
  const fullLabel = row.fullHitLabel || 'full hit rate'
  const line = `${one(facts.line)} ${prop}`
  const listed = []
  if (l5 != null) listed.push(`the last-5 hit rate is ${pct(l5)}`)
  if (l10 != null) listed.push(`the last-10 hit rate is ${pct(l10)}`)
  if (full != null) listed.push(`the ${fullLabel} is ${pct(full)}`)
  const listedSentence = listed.length ? `${cap(listJoin(listed))}. ` : ''
  const countWord = listed.length === 1 ? 'That number counts' : 'Those numbers count'
  const meaning = listed.length
    ? `${countWord} how often ${who} went over ${line} in that window. ${listed.length === 1 ? 'It does' : 'They do'} not set the ${row.scoreLabel === 'score' ? 'score' : 'rating'}. `
    : `The hit-rate columns count how often ${who} went over ${line}. They do not set the ${row.scoreLabel === 'score' ? 'score' : 'rating'}. `
  const label = row.scoreLabel === 'score' ? 'score' : 'rating'
  let disagreement = `The ${label} only compares the projection with the line.`
  const l5DisagreesOver = facts.side === 'Over' && l5 != null && l5 < 50
  const l5DisagreesUnder = facts.side === 'Under' && l5 != null && l5 > 50
  if (l5DisagreesOver) {
    disagreement = longTrackRecord(spec)
      ? `A ${label} can still lean over when the last five games rarely cleared the line, because the projection is still above the line and most of its weight is on the longer track record rather than those five games.`
      : `A ${label} can still lean over when the last five games rarely cleared the line, because it uses the projected average, not that yes-or-no hit rate.`
  } else if (l5DisagreesUnder) {
    disagreement = `A ${label} can still lean under when the last five games cleared the line often, because the projection is still below the line. The hit rate does not pull it the other way.`
  }
  let cg = ''
  const cgScore = num(row.cg_projection)
  if (cgScore != null) {
    cg = l5DisagreesOver || l5DisagreesUnder
      ? ` The CG score of ${Math.round(cgScore)} is separate. It does use the hit rates, so a last-5 rate that disagrees with the projection moves the CG score without changing this ${label}.`
      : ` The CG score of ${Math.round(cgScore)} is separate, and it is the number that mixes in the hit rates.`
  }
  return `${listedSentence}${meaning}${disagreement}${cg}`
}

function listJoin(items) {
  if (items.length === 1) return items[0]
  if (items.length === 2) return `${items[0]}, and ${items[1]}`
  return `${items.slice(0, -1).join(', ')}, and ${items[items.length - 1]}`
}

export function explainProp(row) {
  const facts = ratingFacts(row || {})
  const scoreLabel = row?.scoreLabel === 'score' ? 'score' : 'rating'
  if (!facts) {
    return {
      title: `Why this ${scoreLabel}`,
      paragraphs: ['This row does not have both a projection and a line, so there is no rating to explain.'],
    }
  }
  const spec = resolveSpec({ ...row, scoreLabel })
  const paragraphs = [ratingParagraph(row, facts, scoreLabel)]
  const built = projectionParagraph(spec, row)
  if (built) paragraphs.push(built)
  paragraphs.push(hitRateParagraph({ ...row, scoreLabel }, facts, spec))
  return {
    title: `Why this ${scoreLabel} is ${one(facts.rating)}`,
    paragraphs,
  }
}

export function boardFormulaLine(sport, prop) {
  const spec = resolveSpec({ sport, prop })
  if (!spec) {
    return 'Open a row to see why that rating was given.'
  }
  if (spec.kind === 'pitcher') {
    const weights = weightText(spec.weights)
    if (spec.timesThree) {
      const cal = spec.cal ? ` Then ${spec.cal[0]} + ${spec.cal[1]} × that total.` : ''
      const opp = spec.opponent ? ' Times how many hits the opponent collects per inning.' : ''
      return `Innings per start × 3, weighted ${weights} on the recent window, this season, and all starts.${opp}${cal}`
    }
    const opp = spec.opponent === 'strikeouts'
      ? ' Times the opponent\'s strikeouts per game versus the league.'
      : spec.opponent === 'hits'
        ? ' Times the opponent\'s hits per inning versus the league.'
        : ''
    const cal = spec.cal ? ` Then ${spec.cal[0]} + ${spec.cal[1]} × that total.` : ''
    return `${cap(spec.rateLabel)} × innings per start, weighted ${weights} on the recent window, this season, and all starts.${opp}${cal}`
  }
  if (spec.kind === 'hrr') {
    const cal = spec.cal ? ` Then ${spec.cal[0]} + ${spec.cal[1]} × that total.` : ''
    const opp = spec.opponent === 'corrected'
      ? ' Scaled by how many hits, runs, and RBI the opponent\'s pitchers allow.'
      : spec.opponent === 'published'
        ? ' Scaled by the opponent\'s own hits, runs, and RBI per game.'
        : ''
    return `Plate appearances (${weightText(spec.paWeights)} on the last 3, last 6, and season) times hit, run, and RBI rates (${weightText(spec.rateWeights)}).${opp}${cal}`
  }
  if (spec.kind === 'tb') {
    return 'Total bases per game, blended from the last 5, last 10, and the season, times opponent total bases, the park home-run factor, handedness, and pitcher WHIP.'
  }
  if (spec.kind === 'fantasy') {
    const cal = spec.cal ? ` Then ${spec.cal[0]} + ${spec.cal[1]} × that total.` : ''
    return `Fantasy points from singles, extra-base hits, runs, RBI, walks, and steals, scaled by opponent, park, handedness, and pitcher WHIP.${cal}`
  }
  if (spec.kind === 'wnba') {
    const [a, b, c] = spec.windows
    const defense = spec.dvp === 'off' ? '' : spec.dvp === 'half' ? ' Defense is a mild adjustment.' : ' Defense against this position is included.'
    return `Per-minute production over the last ${a}, ${b}, and ${c} games (${weightText(spec.weights)}), times minutes from the last ${spec.minutes} games.${defense}`
  }
  if (spec.kind === 'nfl') {
    const [a, b, c] = spec.windows
    const cal = spec.cal ? ` Then ${spec.cal[0]} + ${spec.cal[1]} × that average.` : ''
    return `Last ${a}, ${b}, and ${c} games at ${weightText(spec.weights)}, using the most recent ${spec.cap} games.${cal}`
  }
  return 'Open a row to see why that rating was given.'
}

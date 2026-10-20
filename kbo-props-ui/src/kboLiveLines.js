// Matchup page props and starter K lines carry the line from the last build.
// Only a live PrizePicks line may show. When the board has no line for that
// player (pulled, no KBO lines at all, the #305 hold, or the board fetch
// failed), the stored line, edge and pick are cleared (NO LINE). Projections
// stay.
import { kboModelProjection, pregameSide } from './kboBoardScore.js'
import { prizepicksPulled } from './nhl/pointsGate.js'

export const normalizeName = (value) => String(value || '')
  .normalize('NFD')
  .replace(/[\u0300-\u036f]/g, '')
  .replace(/[’'`]/g, '')
  .replace(/-/g, ' ')
  .replace(/\s+/g, ' ')
  .trim()
  .toLowerCase()

export const nameSignature = (value) => normalizeName(value)
  .split(' ')
  .filter(Boolean)
  .sort()
  .join(' ')

// A board that loaded (even with no cards) can say which lines are live.
export function boardCanConfirm(prizepicksData) {
  return !!prizepicksData && prizepicksData.failed !== true && Array.isArray(prizepicksData.cards)
}

export function boardOnHold(prizepicksData) {
  return prizepicksData?.kbo_hold?.active === true
}

export function withoutLiveLine(prop) {
  return { ...prop, line: null, edge: null, recommendation: 'NO LINE' }
}

const STAT_ALIAS = {
  Strikeouts: ['Pitcher Strikeouts'],
  'Pitching Outs': ['Pitching Outs'],
  'Hits Allowed': ['Hits Allowed', 'Pitcher Hits Allowed'],
  'Hits+Runs+RBIs': ['Hits+Runs+RBIs'],
  'Total Bases': ['Total Bases'],
  'Fantasy Score': ['Hitter Fantasy Score'],
}

// Exact name or name-signature match only, on the same team and opponent.
// There is no team/opponent fallback: a pulled line for one player must
// never show as another player's line.
export function liveLineLookup(cards) {
  const lineMap = new Map()
  for (const card of cards || []) {
    const team = card?.team || ''
    const opp = card?.opponent || ''
    const norm = normalizeName(card?.name)
    const sig = nameSignature(card?.name)
    const byStat = new Map()
    for (const prop of card?.props || []) {
      if (prizepicksPulled(prop)) continue
      const line = Number(prop?.line)
      if (prop?.line == null || prop?.line === '' || !Number.isFinite(line)) continue
      if (!byStat.has(prop?.stat)) byStat.set(prop?.stat, [])
      byStat.get(prop?.stat).push(line)
    }
    for (const [stat, lines] of byStat.entries()) {
      lines.sort((a, b) => a - b)
      const canonicalLine = lines[Math.floor(lines.length / 2)]
      if (norm) lineMap.set(`${stat}@@${team}@@${opp}@@${norm}`, canonicalLine)
      if (sig) lineMap.set(`${stat}@@${team}@@${opp}@@sig:${sig}`, canonicalLine)
    }
  }
  return ({ statNames, team, opponent, name }) => {
    const norm = normalizeName(name)
    const sig = nameSignature(name)
    if (!norm) return null
    for (const stat of statNames) {
      const line = lineMap.get(`${stat}@@${team}@@${opponent}@@${norm}`)
        ?? lineMap.get(`${stat}@@${team}@@${opponent}@@sig:${sig}`)
      if (Number.isFinite(line)) return line
    }
    return null
  }
}

function clearedGame(game) {
  return {
    ...game,
    away_pitcher: game?.away_pitcher ? { ...game.away_pitcher, line: null } : game?.away_pitcher,
    home_pitcher: game?.home_pitcher ? { ...game.home_pitcher, line: null } : game?.home_pitcher,
    props: (game?.props || []).map(withoutLiveLine),
  }
}

export function mergeLivePrizePicks(matchupData, prizepicksData) {
  const matchups = matchupData?.matchups || []
  // Fail closed: a failed board fetch or the manual KBO hold shows no lines.
  if (!boardCanConfirm(prizepicksData) || boardOnHold(prizepicksData)) {
    return { ...matchupData, matchups: matchups.map(clearedGame) }
  }
  const getLine = liveLineLookup(prizepicksData.cards)

  return {
    ...matchupData,
    matchups: matchups.map((game) => {
      const awayPitcherName = game?.away_pitcher?.name
      const homePitcherName = game?.home_pitcher?.name
      const awayKLine = awayPitcherName
        ? getLine({ statNames: ['Pitcher Strikeouts'], team: game.away, opponent: game.home, name: awayPitcherName })
        : null
      const homeKLine = homePitcherName
        ? getLine({ statNames: ['Pitcher Strikeouts'], team: game.home, opponent: game.away, name: homePitcherName })
        : null

      const props = (game?.props || []).map((prop) => {
        const mappedStats = STAT_ALIAS[prop?.prop] || []
        if (!mappedStats.length) return withoutLiveLine(prop)

        const propTeam = prop?.team || ''
        const inferredOpponent = prop?.opponent
          || (propTeam && game?.away === propTeam ? game?.home : null)
          || (propTeam && game?.home === propTeam ? game?.away : null)
          || ''
        const liveLine = getLine({ statNames: mappedStats, team: propTeam, opponent: inferredOpponent, name: prop?.name || '' })
        if (!Number.isFinite(liveLine)) return withoutLiveLine(prop)

        // null/'' projection or formula_source 'none' stays null (Number(null)
        // would show edge -line and UNDER). A 0 projection is still a number.
        const projection = kboModelProjection(prop)
        const edge = projection != null ? projection - liveLine : null
        return {
          ...prop,
          line: liveLine,
          edge: edge != null ? Number(edge.toFixed(2)) : null,
          recommendation: pregameSide(projection, liveLine),
        }
      })

      return {
        ...game,
        away_pitcher: game?.away_pitcher
          ? { ...game.away_pitcher, line: Number.isFinite(awayKLine) ? awayKLine : null }
          : game?.away_pitcher,
        home_pitcher: game?.home_pitcher
          ? { ...game.home_pitcher, line: Number.isFinite(homeKLine) ? homeKLine : null }
          : game?.home_pitcher,
        props,
      }
    }),
  }
}

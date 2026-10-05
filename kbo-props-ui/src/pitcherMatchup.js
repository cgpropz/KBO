// Pitcher matchup math for KBO batter pages.
// Green means an easier matchup for the hitter. The neutral band is a small
// relative window around the league rate (see NEUTRAL_BAND).

export const NEUTRAL_BAND = 0.05

export const MATCHUP_STATS = [
  { key: 'era', label: 'ERA', digits: 2, direction: 'higher' },
  { key: 'whip', label: 'WHIP', digits: 2, direction: 'higher' },
  { key: 'baa', label: 'Avg allowed', digits: 3, avg: true, direction: 'higher' },
  { key: 'k_pct', label: 'Strikeout %', digits: 1, pct: true, direction: 'lower' },
  { key: 'h_per_ip', label: 'Hits / inning', digits: 3, direction: 'higher' },
  { key: 'bb_pct', label: 'Walk %', digits: 1, pct: true, direction: 'higher' },
  { key: 'hr_per_9', label: 'HR per 9', digits: 2, direction: 'higher' },
  { key: 'ip', label: 'Innings', digits: 1, direction: null },
]

export function num(value) {
  if (value == null || value === '') return null
  const n = Number(value)
  return Number.isFinite(n) ? n : null
}

export function nameKey(value) {
  return String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[’'`]/g, '')
    .replace(/-/g, ' ')
    .toLowerCase()
    .split(/\s+/)
    .filter(Boolean)
    .sort()
    .join(' ')
}

function sameTeam(a, b) {
  return String(a || '').trim().toLowerCase() === String(b || '').trim().toLowerCase()
}

const DATE_FIELDS = ['game_date', 'gameDate', 'start_time', 'startTime', 'starts_at', 'start_time_utc']
const PITCHER_FIELDS = ['opp_pitcher', 'opposing_pitcher', 'oppPitcher', 'opposingPitcher', 'vs_pitcher', 'versus_pitcher']

export function gameDateKey(value) {
  if (value == null || value === '') return null
  const text = String(value).trim()
  const compact = text.match(/^(\d{4})(\d{2})(\d{2})$/)
  if (compact) return `${compact[1]}-${compact[2]}-${compact[3]}`
  const slash = text.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/)
  if (slash) return `${slash[3]}-${slash[1].padStart(2, '0')}-${slash[2].padStart(2, '0')}`
  if (/^\d{4}-\d{2}-\d{2}$/.test(text)) return text
  const parsed = Date.parse(text)
  if (!Number.isFinite(parsed)) return null
  return new Date(parsed + 9 * 60 * 60 * 1000).toISOString().slice(0, 10)
}

export function readGameDate(...sources) {
  for (const source of sources) {
    if (!source || typeof source !== 'object') continue
    for (const key of DATE_FIELDS) {
      const date = gameDateKey(source[key])
      if (date) return date
    }
  }
  return null
}

function readNamedPitcher(source) {
  if (!source || typeof source !== 'object') return null
  for (const key of PITCHER_FIELDS) {
    const value = source[key]
    if (value == null || value === '') continue
    if (typeof value === 'string' || typeof value === 'number') {
      const name = String(value).trim()
      if (!name) continue
      return {
        name,
        team: source.opp_pitcher_team || source.opposing_pitcher_team || source.oppPitcherTeam || null,
        profile: null,
      }
    }
    if (typeof value === 'object') {
      const name = String(value.name || value.profile?.name || '').trim()
      if (!name) continue
      return {
        name,
        team: value.team || source.opp_pitcher_team || null,
        profile: value.profile || null,
        hand: value.hand || value.profile?.hand || null,
      }
    }
  }
  return null
}

export function readOppPitcher(...sources) {
  for (const source of sources) {
    const pitcher = readNamedPitcher(source)
    if (pitcher) return pitcher
  }
  return null
}

function teamsForName(name, rows) {
  const key = nameKey(name)
  if (!key) return []
  return [...new Set(
    (rows || [])
      .filter((row) => row && nameKey(row.name) === key && row.team)
      .map((row) => row.team),
  )]
}

function teamConflicts(name, statedTeam, opponent, seasonRates, rankings) {
  if (!opponent) return true
  if (statedTeam && !sameTeam(statedTeam, opponent)) return true
  if (statedTeam && sameTeam(statedTeam, opponent)) return false
  const known = [...teamsForName(name, seasonRates), ...teamsForName(name, rankings)]
  if (!known.length) return false
  return !known.some((team) => sameTeam(team, opponent))
}

function samePairing(game, batterTeam, opponent) {
  if (!game || !batterTeam || !opponent) return false
  const sides = [game.home, game.away]
  return sides.some((side) => sameTeam(side, batterTeam)) && sides.some((side) => sameTeam(side, opponent))
}

function resolvedGameDate(game, slateDate) {
  return readGameDate(game) || gameDateKey(slateDate)
}

function gameOnDate(game, propDate, slateDate) {
  if (!propDate) return true
  const gameDate = resolvedGameDate(game, slateDate)
  if (!gameDate) return false
  return gameDate === propDate
}

function opponentSide(game, opponent) {
  if (!game) return null
  if (sameTeam(game.away, opponent)) return { pitcher: game.away_pitcher || null, team: game.away || opponent }
  if (sameTeam(game.home, opponent)) return { pitcher: game.home_pitcher || null, team: game.home || opponent }
  return null
}

export function normalizeHand(value) {
  const hand = String(value || '').trim().toUpperCase()
  return hand === 'L' || hand === 'R' ? hand : null
}

export function handLabel(hand) {
  if (hand === 'L') return 'LHP'
  if (hand === 'R') return 'RHP'
  return null
}

function isFallbackProfile(profile) {
  if (!profile || typeof profile !== 'object') return false
  const keys = Object.keys(profile)
  return keys.length === 1 && keys[0] === 'whip'
}

export function announcedStarter(pitcher) {
  const name = String(pitcher?.name || pitcher?.profile?.name || '').trim()
  return name || null
}

export function rateTone(value, league, direction, band = NEUTRAL_BAND) {
  if (!direction) return 'neutral'
  const stat = num(value)
  const average = num(league)
  if (stat == null || average == null || average === 0) return 'neutral'
  const gap = (stat - average) / Math.abs(average)
  if (Math.abs(gap) <= band) return 'neutral'
  const easier = direction === 'higher' ? gap > 0 : gap < 0
  return easier ? 'easy' : 'tough'
}

function nameParts(value) {
  return nameKey(value).split(' ').filter(Boolean)
}

function pickByName(rows, name, team, teamField = 'team') {
  const parts = nameParts(name)
  if (!parts.length) return null
  const exactKey = parts.join(' ')
  let matches = (rows || []).filter((row) => row && nameKey(row.name) === exactKey)
  const exact = matches.length > 0
  // "Daniel" / "White" are the single names mykbostats shows. Use one only when
  // a single pitcher on that team has it, so Owen White is not Mitch White.
  if (!matches.length && parts.length === 1) {
    matches = (rows || []).filter((row) => nameParts(row.name).includes(parts[0]))
  }
  if (!matches.length) return null
  if (team) {
    const onTeam = matches.filter((row) => sameTeam(row[teamField], team))
    if (!onTeam.length) return null
    matches = onTeam
  }
  if (!exact && new Set(matches.map((row) => nameKey(row.name))).size > 1) return null
  return matches.slice().sort((a, b) => (num(b.starts) || num(b.gs) || 0) - (num(a.starts) || num(a.gs) || 0))[0]
}

function canonicalStarterName(announced, row) {
  if (!row?.name) return announced
  const announcedParts = nameParts(announced)
  const rowParts = nameParts(row.name)
  if (!announcedParts.length) return row.name
  if (announcedParts.join(' ') === rowParts.join(' ')) return row.name
  if (announcedParts.length < rowParts.length && announcedParts.every((part) => rowParts.includes(part))) return row.name
  return announced
}

export function leagueFromRankings(rankings) {
  let weight = 0
  const sums = { era: 0, whip: 0, baa: 0, k_pct: 0 }
  let hits = 0
  for (const row of rankings || []) {
    const innings = (num(row?.ip_per_g) || 0) * (num(row?.gs) || 0)
    if (innings <= 0) continue
    weight += innings
    hits += (num(row.ha_per_g) || 0) * (num(row.gs) || 0)
    for (const key of Object.keys(sums)) {
      const value = num(row[key])
      if (value != null) sums[key] += value * innings
    }
  }
  if (weight <= 0) return null
  return {
    era: sums.era / weight,
    whip: sums.whip / weight,
    baa: sums.baa / weight,
    k_pct: sums.k_pct / weight,
    h_per_ip: hits / weight,
    bb_pct: null,
    hr_per_9: null,
    source: 'pitcher_rankings',
  }
}

export function resolveLeague(matchupLeague, fileLeague, rankings) {
  if (num(matchupLeague?.era) != null && num(matchupLeague?.baa) != null) return matchupLeague
  if (num(fileLeague?.era) != null && num(fileLeague?.baa) != null) return fileLeague
  return leagueFromRankings(rankings)
}

export function derivePitcherRates(profile, ranking) {
  if (isFallbackProfile(profile)) profile = null
  const era = num(profile?.era)
  const whip = num(profile?.whip)
  const ip = num(profile?.total_ip ?? profile?.ip)
  const homeRuns = num(profile?.total_hr)
  const baa = num(ranking?.baa)
  const ipPerGame = num(ranking?.ip_per_g)
  const hitsPerGame = num(ranking?.ha_per_g)
  const starts = num(ranking?.gs)
  let bbPct = null
  if (ip != null && ip > 0 && whip != null && baa != null && baa > 0 && starts != null && starts > 0 && hitsPerGame != null) {
    const hits = hitsPerGame * starts
    const walks = whip * ip - hits
    const faced = hits / baa
    if (faced > 0 && walks >= 0) bbPct = (walks / faced) * 100
  }
  return {
    era,
    whip,
    ip,
    baa,
    k_pct: num(ranking?.k_pct),
    bb_pct: bbPct,
    h_per_ip: ipPerGame != null && ipPerGame > 0 && hitsPerGame != null ? hitsPerGame / ipPerGame : null,
    hr_per_9: num(profile?.hr_per_9) ?? (ip != null && ip > 0 && homeRuns != null ? (homeRuns * 9) / ip : null),
  }
}

function firstFinite(...values) {
  for (const value of values) {
    const n = num(value)
    if (n != null) return n
  }
  return null
}

export function resolvePitcherRates(profile, ranking, seasonRate) {
  const usable = isFallbackProfile(profile) ? null : profile
  const derived = derivePitcherRates(usable, ranking)
  const season = seasonRate || {}
  return {
    era: firstFinite(usable?.era, season.era, derived.era),
    whip: firstFinite(usable?.whip, season.whip, derived.whip),
    ip: firstFinite(usable?.total_ip, usable?.ip, season.ip, derived.ip),
    baa: firstFinite(usable?.baa, season.baa, derived.baa),
    k_pct: firstFinite(usable?.k_pct, season.k_pct, derived.k_pct),
    bb_pct: firstFinite(usable?.bb_pct, season.bb_pct, derived.bb_pct),
    h_per_ip: firstFinite(usable?.h_per_ip, season.h_per_ip, derived.h_per_ip),
    hr_per_9: firstFinite(usable?.hr_per_9, season.hr_per_9, derived.hr_per_9),
    hand: normalizeHand(usable?.hand) || normalizeHand(season.hand),
    starts: firstFinite(usable?.starts, season.starts, ranking?.gs),
  }
}

export function formatStat(value, spec) {
  const n = num(value)
  if (n == null || !spec) return '—'
  if (spec.avg) return n.toFixed(spec.digits).replace(/^0\./, '.')
  const text = n.toFixed(spec.digits)
  return spec.pct ? `${text}%` : text
}

function emptyMatch(detail) {
  return { starterName: null, team: '', emptyDetail: detail, stats: [] }
}

export function buildPitcherMatchup({
  batterTeam,
  opponent,
  sources,
  matchups,
  slateDate,
  rankings,
  league,
  seasonRates,
}) {
  const team = String(batterTeam || '').trim()
  const opponentTeam = String(opponent || '').trim()
  const gameLabel = [team, opponentTeam].filter(Boolean).join(' vs ')
  if (!opponentTeam) {
    return emptyMatch(team
      ? `${team} does not have an opponent on this PrizePicks prop.`
      : 'This PrizePicks prop does not list an opponent.')
  }

  const propDate = readGameDate(...(sources || []))
  const slate = gameDateKey(slateDate)
  const pairing = (matchups || []).filter((game) => samePairing(game, team, opponentTeam))
  const dated = pairing.filter((game) => gameOnDate(game, propDate, slate))
  const listed = readOppPitcher(...(sources || []))
  const listedOk = listed && !teamConflicts(listed.name, listed.team, opponentTeam, seasonRates, rankings)
    ? listed
    : null

  let starterName = null
  let profile = null
  if (listedOk) {
    starterName = listedOk.name
    profile = isFallbackProfile(listedOk.profile) ? null : listedOk.profile
    const side = dated.map((game) => opponentSide(game, opponentTeam)).find((entry) => {
      const announced = announcedStarter(entry?.pitcher)
      return announced && nameKey(announced) === nameKey(starterName)
    })
    if (side?.pitcher?.profile && !isFallbackProfile(side.pitcher.profile)) profile = side.pitcher.profile
  } else if (propDate && pairing.length && !dated.length) {
    return emptyMatch(`No starter is posted for ${gameLabel} on this game date.`)
  } else if (!dated.length) {
    return emptyMatch(`No starter is posted for ${gameLabel}.`)
  } else {
    const side = dated.map((game) => opponentSide(game, opponentTeam)).find((entry) => announcedStarter(entry?.pitcher))
    starterName = announcedStarter(side?.pitcher)
    if (!starterName || teamConflicts(starterName, side?.team, opponentTeam, seasonRates, rankings)) {
      return emptyMatch(`The starter for ${opponentTeam} has not been posted yet.`)
    }
    profile = isFallbackProfile(side?.pitcher?.profile) ? null : side?.pitcher?.profile
  }

  const ranking = pickByName(rankings, starterName, opponentTeam)
  const seasonRate = pickByName(seasonRates, starterName, opponentTeam)
  starterName = canonicalStarterName(starterName, seasonRate || ranking)
  const rates = resolvePitcherRates(profile, ranking, seasonRate)
  if (listedOk?.hand) rates.hand = normalizeHand(listedOk.hand) || rates.hand
  const stats = MATCHUP_STATS.map((spec) => {
    const value = rates[spec.key]
    const leagueValue = spec.direction ? num(league?.[spec.key]) : null
    return {
      ...spec,
      value,
      leagueValue,
      tone: rateTone(value, leagueValue, spec.direction),
      display: formatStat(value, spec),
      leagueDisplay: spec.direction ? formatStat(leagueValue, spec) : null,
    }
  })
  const hasRate = stats.some((stat) => stat.direction && stat.value != null)
  return {
    starterName,
    team: opponentTeam,
    hand: rates.hand,
    handLabel: handLabel(rates.hand),
    starts: rates.starts,
    stats,
    statsNote: hasRate ? null : 'Season stats are not in the logs yet.',
    emptyDetail: null,
  }
}

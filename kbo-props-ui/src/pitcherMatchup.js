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

export function opposingStarter(matchups, batterTeam) {
  const team = String(batterTeam || '').trim()
  if (!team) return null
  for (const game of matchups || []) {
    if (!game || typeof game !== 'object') continue
    if (sameTeam(game.home, team)) {
      return { game, pitcher: game.away_pitcher || null, opponentTeam: game.away || '' }
    }
    if (sameTeam(game.away, team)) {
      return { game, pitcher: game.home_pitcher || null, opponentTeam: game.home || '' }
    }
  }
  return null
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

function pickByName(rows, name, team, teamField = 'team') {
  const key = nameKey(name)
  if (!key) return null
  const matches = (rows || []).filter((row) => row && nameKey(row.name) === key)
  if (!matches.length) return null
  const onTeam = matches.filter((row) => sameTeam(row[teamField], team))
  const pool = onTeam.length ? onTeam : matches
  return pool.slice().sort((a, b) => (num(b.starts) || num(b.gs) || 0) - (num(a.starts) || num(a.gs) || 0))[0]
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

export function buildPitcherMatchup({ batterTeam, matchups, rankings, league, seasonRates }) {
  const team = String(batterTeam || '').trim()
  const found = opposingStarter(matchups, team)
  if (!found) {
    return {
      starterName: null,
      emptyDetail: team
        ? `${team} is not on today's slate.`
        : 'No probable starter is posted for this game.',
    }
  }
  const starterName = announcedStarter(found.pitcher)
  if (!starterName) {
    return {
      starterName: null,
      emptyDetail: team
        ? `The probable starter against ${team} has not been posted yet.`
        : 'The probable starter has not been posted yet.',
    }
  }
  const ranking = pickByName(rankings, starterName, found.opponentTeam)
  const seasonRate = pickByName(seasonRates, starterName, found.opponentTeam)
  const rates = resolvePitcherRates(found.pitcher?.profile, ranking, seasonRate)
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
    team: found.opponentTeam || seasonRate?.team || ranking?.team || '',
    hand: rates.hand,
    handLabel: handLabel(rates.hand),
    starts: rates.starts,
    stats,
    statsNote: hasRate ? null : 'Season stats are not in the logs yet.',
    emptyDetail: null,
  }
}

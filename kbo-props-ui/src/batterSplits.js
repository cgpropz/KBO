// Platoon splits for KBO batter pages.
// Hit rate uses the opposing starter's throwing hand. Season average is the
// official KBO split and is never filled in when that file has no row.

import { gameDateKey, nameKey } from './pitcherMatchup.js'

const TEAM_ALIASES = {
  DOO: 'Doosan', DOOSAN: 'Doosan',
  HAN: 'Hanwha', HANWHA: 'Hanwha',
  KIA: 'Kia',
  KIW: 'Kiwoom', KIWOOM: 'Kiwoom',
  KT: 'KT', KTW: 'KT',
  LG: 'LG',
  LOT: 'Lotte', LOTTE: 'Lotte',
  NC: 'NC', NCD: 'NC',
  SAM: 'Samsung', SAMSUNG: 'Samsung',
  SSG: 'SSG',
}

export function canonicalTeam(value) {
  const text = String(value || '').trim()
  if (!text) return ''
  return TEAM_ALIASES[text] || TEAM_ALIASES[text.toUpperCase()] || text
}

export function battingHand(value) {
  const hand = String(value || '').trim().toUpperCase()
  if (hand === 'L' || hand === 'LH' || hand === 'LHH' || hand === 'LEFT') return 'L'
  if (hand === 'R' || hand === 'RH' || hand === 'RHH' || hand === 'RIGHT') return 'R'
  if (hand === 'S' || hand === 'SH' || hand === 'SWITCH') return 'S'
  return null
}

export function throwingHand(value) {
  const hand = String(value || '').trim().toUpperCase()
  if (hand === 'L' || hand === 'LH' || hand === 'LHP' || hand === 'LEFT') return 'L'
  if (hand === 'R' || hand === 'RH' || hand === 'RHP' || hand === 'RIGHT') return 'R'
  return null
}

export function battingHandPhrase(hand) {
  if (hand === 'L') return 'Bats L'
  if (hand === 'R') return 'Bats R'
  if (hand === 'S') return 'Bats S'
  return null
}

export function starterHandKey(dateValue, team) {
  const date = gameDateKey(dateValue)
  const club = canonicalTeam(team)
  if (!date || !club) return null
  return `${date}|${club}`
}

export function batterProfile(context, name) {
  const key = nameKey(name)
  if (!key || !context?.batters) return null
  return context.batters[key] || null
}

export function projectionRow(rows, name) {
  const key = nameKey(name)
  if (!key) return null
  return (rows || []).find((row) => nameKey(row?.name) === key || nameKey(row?.pp_name) === key) || null
}

export function resolveBattingHand(card, profile, projection) {
  return battingHand(card?.batting_hand)
    || battingHand(card?.batter_hand)
    || battingHand(profile?.hand)
    || battingHand(projection?.batter_hand)
}

export function withStarterHands(games, starters) {
  const index = starters || {}
  return (games || []).map((game) => {
    const stamped = throwingHand(game?.opp_hand)
    if (stamped) return { ...game, opp_hand: stamped }
    const key = starterHandKey(game?.date, game?.opp)
    const lookedUp = key ? throwingHand(index[key]) : null
    return { ...game, opp_hand: lookedUp }
  })
}

export function propSplit(games, getValue, line, hand, season) {
  if (typeof getValue !== 'function' || line == null || (hand !== 'L' && hand !== 'R')) {
    return { pct: null, hits: 0, games: 0, avg: null }
  }
  const values = []
  for (const game of games || []) {
    if (season != null && String(game?.season ?? '') !== String(season)) continue
    if (game?.opp_hand !== hand) continue
    const value = Number(getValue(game))
    if (!Number.isFinite(value)) continue
    values.push(value)
  }
  if (!values.length) return { pct: null, hits: 0, games: 0, avg: null }
  const hits = values.filter((value) => value > Number(line)).length
  return {
    pct: Math.round((hits / values.length) * 100),
    hits,
    games: values.length,
    avg: values.reduce((sum, value) => sum + value, 0) / values.length,
  }
}

function projectionSplit(projection, side) {
  if (!projection) return null
  const prefix = side === 'L' ? 'vs_lhp' : 'vs_rhp'
  const avg = Number(projection[`${prefix}_avg`])
  const ab = Number(projection[`${prefix}_ab`])
  if (!Number.isFinite(avg) || !Number.isFinite(ab) || ab <= 0) return null
  return { avg, ab }
}

export function seasonSplit(profile, projection, side) {
  const fromFile = profile?.[side === 'L' ? 'vs_lhp' : 'vs_rhp']
  if (fromFile && Number(fromFile.ab) > 0 && fromFile.avg != null && Number.isFinite(Number(fromFile.avg))) {
    return fromFile
  }
  return projectionSplit(projection, side)
}

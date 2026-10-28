// Live cheatsheet packs. Numbers are copied off feeds the board already
// publishes. This file does not score, rank, or price a game.
//
// NFL: nfl_game_markets (nflGameSheet.js), plus lineup record and roof.
// NBA: nba_teams[].game when home/away was published. No game-total model.
// NHL: nhl lineups, or projection rows that already name awayTeam/homeTeam.
// WNBA: Rotowire lineups (visitor / home / gameTime). No game-total model.
// KBO: matchup_data games, plus moneyline, spread, and total when game lines
// were attached. Pitcher and batter props are not summed into a team score.

import { finite } from '../nfl/gameCardModel.js'
import { formatTip } from '../nba/nbaPlayersList.js'
import { TEAM_NAMES } from '../nhl/nhlTeams.js'
import { landingTeamFill } from '../playerMark.js'
import { teamColor as wnbaTeamColor } from '../wnba/utils/formatters.js'
import { CHEATSHEET_SPORTS } from './access.js'
import { indexGames } from './sheetModel.js'

export const LIVE_GAPS = {
  nba: 'NBA has no game-total model. This slate is the published team schedule. Totals, spreads, moneylines, and CG scores are not on that feed.',
  nhl: 'NHL has no game-total model. This slate is the live lineup or prop board. Totals, spreads, moneylines, and CG scores are not published.',
  wnba: 'WNBA has no game-total model. This slate is the live lineup feed. Totals, spreads, moneylines, and CG scores are not published.',
  kbo: 'KBO has no team-score model. Market totals, spreads, and moneylines are shown only when the matchup feed already has them. Player props are not added into a team score.',
}

export const UNAVAILABLE_NOTES = {
  nflPreview: 'The NFL game-markets feed is still a preview. This sheet waits for the full snapshot and does not show the example game.',
  nflEmpty: 'No games are on the NFL game-markets feed.',
  nflLoad: 'The NFL game-markets feed did not load.',
  nbaPreview: 'The NBA team schedule is still a preview. This sheet waits for the full snapshot.',
  nbaEmpty: 'No NBA game with a published home and away is on the team schedule. Player props are not used as a game total.',
  nbaLoad: 'The NBA team schedule did not load.',
  nhlPreview: 'The NHL slate is still a preview. This sheet waits for the full lineup or prop snapshot.',
  nhlEmpty: 'No NHL games are on the lineup or prop feed.',
  nhlLoad: 'The NHL slate did not load.',
  wnbaPreview: 'The WNBA lineup feed is still a preview. This sheet waits for the full snapshot.',
  wnbaEmpty: 'No WNBA games are on the lineup feed.',
  wnbaLoad: 'The WNBA lineup feed did not load.',
  kboPreview: 'The KBO matchup feed is still a preview. This sheet waits for the full snapshot.',
  kboEmpty: 'No KBO games are on the matchup feed.',
  kboLoad: 'The KBO matchup feed did not load.',
}

const KBO_ABBR = {
  doosan: 'DOO',
  hanwha: 'HAN',
  kia: 'KIA',
  kiwoom: 'KIW',
  kt: 'KT',
  lg: 'LG',
  lotte: 'LOT',
  nc: 'NC',
  samsung: 'SAM',
  ssg: 'SSG',
}

export function sportName(sportId) {
  return CHEATSHEET_SPORTS.find((sport) => sport.id === sportId)?.name || 'NFL'
}

export function sourceLabel(pack) {
  if (pack?.example) return 'Example sheet'
  if (pack?.status === 'waiting') return 'Loading live board'
  if (pack?.status === 'unavailable') return 'Live board unavailable'
  if (pack?.model === 'game-markets') return 'Live game markets'
  return 'Live slate'
}

export function waitingPack(sportId) {
  const sport = sportName(sportId)
  return {
    id: sportId || 'nfl',
    sport,
    weekLabel: sport,
    example: false,
    status: 'waiting',
    model: null,
    label: '',
    chart: null,
    detailNote: 'Loading the live board.',
    games: [],
  }
}

export function unavailablePack(sportId, detailNote) {
  const sport = sportName(sportId)
  return {
    id: sportId || 'nfl',
    sport,
    weekLabel: sport,
    example: false,
    status: 'unavailable',
    model: null,
    label: '',
    chart: null,
    detailNote: detailNote || `${sport} has no live game sheet.`,
    games: [],
  }
}

function emptyCg() {
  return {
    away_score: null,
    home_score: null,
    total: null,
    total_edge: null,
    total_lean: '',
    side_proj: null,
    side_lean: '',
    side_edge: null,
    cg_score_total: null,
    cg_score_spread: null,
  }
}

function emptyMarket() {
  return {
    books: null,
    bookName: '',
    total: null,
    spread: { favorite: '', line: null },
    ml: {},
  }
}

function shellGame(spec) {
  return {
    id: spec.id,
    listKick: spec.listKick || '',
    kickSort: spec.kickSort || '',
    game: {
      away: spec.away,
      home: spec.home,
      kickoff: spec.kickoff || '',
      venue: spec.venue || '',
      surface: spec.surface || '',
    },
    market: spec.market || emptyMarket(),
    cg: emptyCg(),
    hit_rates_over: null,
    historical_totals: null,
    matchups: null,
    pace: null,
    dvp: null,
    components: null,
  }
}

function slatePack(id, weekLabel, games, detailNote) {
  return {
    id,
    sport: sportName(id),
    weekLabel,
    example: false,
    status: 'live',
    model: 'slate',
    label: '',
    chart: null,
    detailNote,
    games: indexGames(games),
  }
}

function colorOf(value) {
  const text = String(value || '').trim()
  if (!text) return ''
  if (text.startsWith('#')) return text
  if (/^[0-9a-fA-F]{6}$/.test(text)) return `#${text}`
  return ''
}

function datePrefix(value) {
  const text = String(value || '')
  return /^\d{4}-\d{2}-\d{2}/.test(text) ? text.slice(0, 10) : ''
}

function slateWeek(sportId, games, fallback) {
  const dates = [...new Set(games.map((game) => datePrefix(game.kickSort)).filter(Boolean))]
  if (dates.length === 1) return `${sportName(sportId)} · ${dates[0]}`
  return fallback
}

export function gamesFromNbaTeams(teams) {
  const list = Array.isArray(teams) ? teams : []
  const byAbbr = new Map(list.map((team) => [String(team?.abbr || '').toUpperCase(), team]))
  const seen = new Set()
  const games = []
  for (const team of list) {
    const posted = team?.game
    if (!posted || posted.home !== true) continue
    const home = String(team.abbr || '').toUpperCase()
    const away = String(posted.opponent || '').toUpperCase()
    if (!home || !away) continue
    const day = datePrefix(posted.date)
    const key = `${day}|${away}@${home}`
    if (seen.has(key)) continue
    seen.add(key)
    const awayTeam = byAbbr.get(away)
    const kick = formatTip(posted.tip)
    games.push(shellGame({
      id: `nba-${day || 'slate'}-${away}-${home}`,
      listKick: kick || day,
      kickSort: posted.tip || posted.date || '',
      away: {
        abbr: away,
        name: awayTeam?.fullName || away,
        city: '',
        record: '',
        color: colorOf(awayTeam?.color) || '#3f3f46',
      },
      home: {
        abbr: home,
        name: team.fullName || home,
        city: '',
        record: '',
        color: colorOf(team.color) || '#3f3f46',
      },
      kickoff: [day, kick].filter(Boolean).join(' · '),
    }))
  }
  return games
}

export function liveNbaPack({ teams, preview = false } = {}) {
  if (preview) return null
  const games = gamesFromNbaTeams(teams)
  if (!games.length) return null
  return slatePack('nba', slateWeek('nba', games, 'NBA · live slate'), games, LIVE_GAPS.nba)
}

function nhlSide(abbr, name) {
  const id = String(abbr || '').toUpperCase()
  return {
    abbr: id,
    name: name || TEAM_NAMES[id] || id,
    city: '',
    record: '',
    color: landingTeamFill('nhl', id),
  }
}

export function gamesFromNhlLineups(rows) {
  return (Array.isArray(rows) ? rows : []).map((game) => {
    const away = String(game?.awayTeam || '').toUpperCase()
    const home = String(game?.homeTeam || '').toUpperCase()
    if (!away || !home) return null
    const day = datePrefix(game.gameday || game.date)
    const kick = game.gametime || ''
    return shellGame({
      id: `nhl-${day || 'slate'}-${away}-${home}`,
      listKick: kick || game.weekday || day,
      kickSort: game.start_time || game.startTimeUTC || `${day}T${kick}`,
      away: nhlSide(away, game.awayName),
      home: nhlSide(home, game.homeName),
      kickoff: [game.weekday, kick].filter(Boolean).join(' · ') || day,
    })
  }).filter(Boolean)
}

export function gamesFromNhlProps(rows) {
  const seen = new Set()
  const games = []
  for (const row of Array.isArray(rows) ? rows : []) {
    const away = String(row?.awayTeam || '').toUpperCase()
    const home = String(row?.homeTeam || '').toUpperCase()
    if (!away || !home) continue
    const day = datePrefix(row.gameday || row.date || row.start_time)
    const id = `nhl-${day || 'slate'}-${away}-${home}`
    if (seen.has(id)) continue
    seen.add(id)
    games.push(shellGame({
      id,
      listKick: day,
      kickSort: row.start_time || day,
      away: nhlSide(away, ''),
      home: nhlSide(home, ''),
      kickoff: day,
    }))
  }
  return games
}

export function liveNhlPack({
  lineups,
  projections,
  lineupsPreview = false,
  projectionsPreview = false,
  lineupsLoaded = false,
} = {}) {
  if (lineupsLoaded && !lineupsPreview) {
    const games = gamesFromNhlLineups(lineups)
    if (!games.length) return null
    return slatePack('nhl', slateWeek('nhl', games, 'NHL · live slate'), games, LIVE_GAPS.nhl)
  }
  if (projectionsPreview) return null
  const games = gamesFromNhlProps(projections)
  if (!games.length) return null
  return slatePack('nhl', slateWeek('nhl', games, 'NHL · live slate'), games, LIVE_GAPS.nhl)
}

function wnbaSide(side) {
  const abbr = String(side?.abbr || '').toUpperCase()
  return {
    abbr,
    name: side?.name || abbr,
    city: '',
    record: '',
    color: wnbaTeamColor(abbr),
  }
}

export function gamesFromWnbaLineups(rows) {
  return (Array.isArray(rows) ? rows : []).map((game, index) => {
    const away = String(game?.visitor?.abbr || '').toUpperCase()
    const home = String(game?.home?.abbr || '').toUpperCase()
    if (!away || !home) return null
    const kick = String(game.gameTime || '').trim()
    return shellGame({
      id: `wnba-${away}-${home}-${index}`,
      listKick: kick,
      kickSort: kick || `${away}-${home}`,
      away: wnbaSide(game.visitor),
      home: wnbaSide(game.home),
      kickoff: kick,
    })
  }).filter(Boolean)
}

export function liveWnbaPack({ lineups, preview = false } = {}) {
  if (preview) return null
  const games = gamesFromWnbaLineups(lineups)
  if (!games.length) return null
  return slatePack('wnba', 'WNBA · live slate', games, LIVE_GAPS.wnba)
}

function kboSide(name) {
  const raw = String(name || '').trim()
  const abbr = KBO_ABBR[raw.toLowerCase()] || raw.slice(0, 3).toUpperCase()
  return {
    abbr,
    name: raw || abbr,
    city: '',
    record: '',
    color: landingTeamFill('kbo', raw),
  }
}

function kboMarket(away, home, market) {
  if (!market) return emptyMarket()
  const awayLine = finite(market.spread?.away)
  const homeLine = finite(market.spread?.home)
  let favorite = ''
  let line = null
  if (awayLine != null && awayLine < 0) {
    favorite = away.abbr
    line = awayLine
  } else if (homeLine != null && homeLine < 0) {
    favorite = home.abbr
    line = homeLine
  } else if (awayLine === 0 || homeLine === 0) {
    favorite = 'PK'
    line = 0
  }
  return {
    books: null,
    bookName: '',
    total: finite(market.total),
    spread: { favorite, line },
    ml: {
      [away.abbr]: finite(market.moneyline?.away),
      [home.abbr]: finite(market.moneyline?.home),
    },
  }
}

function kboKey(away, home) {
  return `${String(away || '').trim().toLowerCase()}::${String(home || '').trim().toLowerCase()}`
}

export function liveKboPack({ matchups, lines, preview = false } = {}) {
  if (preview) return null
  const payload = matchups && !Array.isArray(matchups) ? matchups : { matchups: matchups || [] }
  const rows = Array.isArray(payload.matchups) ? payload.matchups : []
  const lineMap = new Map((lines?.games || []).map((game) => [kboKey(game.away, game.home), game]))
  const games = rows.map((game) => {
    const awayName = game?.away
    const homeName = game?.home
    if (!awayName || !homeName) return null
    const away = kboSide(awayName)
    const home = kboSide(homeName)
    const day = datePrefix(game.game_date || payload.game_date)
    const market = game.market || lineMap.get(kboKey(awayName, homeName)) || null
    return shellGame({
      id: `kbo-${day || 'slate'}-${away.abbr}-${home.abbr}`,
      listKick: day,
      kickSort: day,
      away,
      home,
      kickoff: day,
      venue: game.stadium || '',
      market: kboMarket(away, home, market),
    })
  }).filter(Boolean)
  if (!games.length) return null
  const week = datePrefix(payload.game_date) ? `KBO · ${datePrefix(payload.game_date)}` : slateWeek('kbo', games, 'KBO · live slate')
  return slatePack('kbo', week, games, LIVE_GAPS.kbo)
}

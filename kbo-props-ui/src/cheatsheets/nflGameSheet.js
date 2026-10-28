// Maps a full nfl_game_markets snapshot onto the cheatsheet sheet.
// Reads the published scores, lines, and edges. Does not rescore them.
// A free preview is refused: that payload drops prices and can drop total edge.
// Lineup rows may add the published record and roof. Their nflverse spread
// and total are not the posted market (see nfl/game_markets.py) and are ignored.

import { teamColor } from '../nfl/nflTeams.js'
import { kickoffLabel, finite } from '../nfl/gameCardModel.js'
import { indexGames } from './sheetModel.js'

export const NFL_DETAIL_NOTE = 'Matchup splits, pace, and DvP are not on the NFL game-markets feed.'

const CITY = {
  ARI: 'Arizona', ATL: 'Atlanta', BAL: 'Baltimore', BUF: 'Buffalo', CAR: 'Carolina',
  CHI: 'Chicago', CIN: 'Cincinnati', CLE: 'Cleveland', DAL: 'Dallas', DEN: 'Denver',
  DET: 'Detroit', GB: 'Green Bay', HOU: 'Houston', IND: 'Indianapolis', JAX: 'Jacksonville',
  KC: 'Kansas City', LA: 'Los Angeles', LAC: 'Los Angeles', LV: 'Las Vegas', MIA: 'Miami',
  MIN: 'Minnesota', NE: 'New England', NO: 'New Orleans', NYG: 'New York', NYJ: 'New York',
  PHI: 'Philadelphia', PIT: 'Pittsburgh', SEA: 'Seattle', SF: 'San Francisco', TB: 'Tampa Bay',
  TEN: 'Tennessee', WAS: 'Washington',
}

function favorite(awaySpread, away, home) {
  const line = finite(awaySpread)
  if (line == null) return { team: '', line: null }
  if (line < 0) return { team: away, line }
  if (line > 0) return { team: home, line: -line }
  return { team: 'PK', line: 0 }
}

function lean(edge) {
  const n = finite(edge)
  if (n == null) return ''
  if (n > 0) return 'OVER'
  if (n < 0) return 'UNDER'
  return 'PUSH'
}

function team(abbr, name) {
  const id = String(abbr || '').toUpperCase()
  return {
    abbr: id,
    name: name || id,
    city: CITY[id] || '',
    record: '',
    color: teamColor(id),
  }
}

export function gameFromNflMarket(game) {
  if (!game?.awayTeam || !game?.homeTeam) return null
  const away = String(game.awayTeam).toUpperCase()
  const home = String(game.homeTeam).toUpperCase()
  const marketSide = favorite(game.spread?.line, away, home)
  const modelSide = favorite(game.spread?.projection, away, home)
  const publishedSpreadEdge = finite(game.spread?.edge)
  const book = game.spread?.book || game.total?.book || game.moneyline?.book || ''
  const kick = kickoffLabel(game)
  return {
    id: String(game.id || `${game.gameday}-${away}-${home}`),
    listKick: kick,
    kickSort: `${game.gameday || ''}T${game.gametime || ''}`,
    game: {
      away: team(away, game.awayName),
      home: team(home, game.homeName),
      kickoff: kick,
      venue: '',
      surface: '',
    },
    market: {
      books: null,
      bookName: book,
      total: finite(game.total?.line),
      spread: { favorite: marketSide.team, line: marketSide.line },
      ml: {
        [home]: finite(game.moneyline?.homePrice ?? game.moneyline?.line),
        [away]: finite(game.moneyline?.awayPrice),
      },
    },
    cg: {
      away_score: finite(game.awayScore),
      home_score: finite(game.homeScore),
      total: finite(game.total?.projection),
      total_edge: finite(game.total?.edge),
      total_lean: lean(game.total?.edge),
      side_proj: modelSide.line,
      side_lean: modelSide.team,
      side_edge: publishedSpreadEdge == null ? null : Math.abs(publishedSpreadEdge),
      cg_score_total: null,
      cg_score_spread: null,
    },
    hit_rates_over: null,
    historical_totals: null,
    matchups: null,
    pace: null,
    dvp: null,
    components: null,
  }
}

export function liveNflPack(payload, { preview = false } = {}) {
  if (preview || payload?.preview === true) return null
  const games = Array.isArray(payload?.games) ? payload.games.map(gameFromNflMarket).filter(Boolean) : []
  if (!games.length) return null
  const week = payload.week == null || payload.week === '' ? 'NFL' : `NFL · Week ${payload.week}`
  return {
    id: 'nfl',
    sport: 'NFL',
    weekLabel: week,
    example: false,
    status: 'live',
    model: 'game-markets',
    label: '',
    chart: null,
    detailNote: NFL_DETAIL_NOTE,
    games: indexGames(games),
  }
}

export function attachNflLineupContext(pack, matchups) {
  if (!pack?.games?.length || !Array.isArray(matchups) || !matchups.length) return pack
  const byPair = new Map()
  for (const row of matchups) {
    const away = String(row?.awayTeam || '').toUpperCase()
    const home = String(row?.homeTeam || '').toUpperCase()
    if (away && home) byPair.set(`${away}@${home}`, row)
  }
  return {
    ...pack,
    games: pack.games.map((game) => {
      const row = byPair.get(`${game.game.away.abbr}@${game.game.home.abbr}`)
      if (!row) return game
      const surface = row.roof || game.game.surface || ''
      return {
        ...game,
        game: {
          ...game.game,
          away: { ...game.game.away, record: row.awayRecord || game.game.away.record || '' },
          home: { ...game.game.home, record: row.homeRecord || game.game.home.record || '' },
          surface,
        },
      }
    }),
  }
}

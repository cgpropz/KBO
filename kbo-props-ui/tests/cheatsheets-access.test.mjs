import assert from 'node:assert/strict'
import test from 'node:test'
import { readFileSync } from 'node:fs'
import { NBA_OWNER_EMAIL } from '../src/entitlements.js'
import {
  cheatsheetsGate,
  cheatsheetsHref,
  layoutFromSearch,
  leagueFromSearch,
  sportChrome,
  stripCheatsheetsSearch,
} from '../src/cheatsheets/access.js'
import { chartPct, formatStat, heatColor, moneyline, signed1 } from '../src/cheatsheets/gameProjFormat.js'
import { CHEATSHEET_PACKS } from '../src/cheatsheets/packs.js'
import { attachNflLineupContext, liveNflPack } from '../src/cheatsheets/nflGameSheet.js'
import { filterGames, filterRows, sortGames, sortRows, toggleSort, visibleGames } from '../src/cheatsheets/boardControls.js'
import {
  LIVE_GAPS,
  UNAVAILABLE_NOTES,
  liveKboPack,
  liveNbaPack,
  liveNhlPack,
  liveWnbaPack,
  sourceLabel,
  unavailablePack,
  waitingPack,
} from '../src/cheatsheets/liveBoard.js'

const example = JSON.parse(readFileSync(new URL('../src/cheatsheets/gameProjExample.json', import.meta.url), 'utf8'))
const proj = readFileSync(new URL('../src/cheatsheets/GameProj.jsx', import.meta.url), 'utf8')
const app = readFileSync(new URL('../src/App.jsx', import.meta.url), 'utf8')
const sheets = readFileSync(new URL('../src/cheatsheets/Cheatsheets.jsx', import.meta.url), 'utf8')

test('only the admin email can open cheatsheets', () => {
  assert.equal(NBA_OWNER_EMAIL, 'cgpropz@gmail.com')
  const admin = { email: 'cgpropz@gmail.com' }
  assert.equal(cheatsheetsGate({ search: '?cheatsheets=1', user: admin }), 'allow')
  assert.equal(cheatsheetsGate({ search: '?cheatsheets=1', user: { email: ' CGPROPZ@gmail.com ' } }), 'allow')
  assert.equal(cheatsheetsGate({ search: '?cheatsheets=1', user: { email: 'monthly@preview.local' } }), 'deny')
  assert.equal(cheatsheetsGate({ search: '?cheatsheets=1', user: { email: 'fan@example.com' } }), 'deny')
  assert.equal(cheatsheetsGate({ search: '?cheatsheets=1', user: null, sessionPending: true }), 'wait')
  assert.equal(cheatsheetsGate({ search: '?cheatsheets=1', user: null, sessionPending: false }), 'deny')
  assert.equal(cheatsheetsGate({ search: '?sport=nfl&page=markets', user: admin }), null)
  assert.equal(stripCheatsheetsSearch('?cheatsheets=1&league=nba&gp=pro&previewTier=monthly'), '?previewTier=monthly')
  assert.equal(cheatsheetsHref('?sport=nfl&previewTier=owner'), '/?cheatsheets=1&previewTier=owner')
})

test('NFL keeps the locked example and every other sport has its own sheet', () => {
  assert.equal(example.label, 'EXAMPLE DATA — not live board')
  assert.equal(example.game.away.abbr, 'DAL')
  assert.equal(example.game.home.abbr, 'PHI')
  assert.equal(example.cg.total, 50.5)
  assert.equal(sportChrome('nfl', example).week, 'NFL · Week 9')
  assert.equal(sportChrome('nba', example).week, 'NBA · EXAMPLE')
  assert.equal(sportChrome('nhl', example).name, 'NHL')
  assert.equal(sportChrome('wnba', example).week, 'WNBA · EXAMPLE')
  assert.equal(sportChrome('kbo', example).week, 'KBO · EXAMPLE')
  assert.equal(leagueFromSearch('?league=nba'), 'nba')
  assert.equal(leagueFromSearch('?league=nope'), 'nfl')
  assert.equal(layoutFromSearch('?gp=pro'), 'pro')
  assert.equal(layoutFromSearch(''), 'standard')
  assert.equal(CHEATSHEET_PACKS.nfl.games[0].id, 'nfl-dal-phi')
  assert.equal(CHEATSHEET_PACKS.nfl.games[0].cg.total, 50.5)
  assert.equal(CHEATSHEET_PACKS.nfl.example, true)
  for (const id of ['nba', 'nhl', 'wnba', 'kbo']) {
    const pack = CHEATSHEET_PACKS[id]
    assert.equal(pack.example, true)
    assert.match(pack.label, /EXAMPLE/)
    assert.notEqual(pack.games[0].game.away.abbr, 'DAL')
    assert.notEqual(pack.games[0].game.home.abbr, 'PHI')
    assert.ok(pack.games.length >= 3)
  }
  assert.equal(CHEATSHEET_PACKS.nba.games[0].game.away.abbr, 'DEN')
  assert.equal(CHEATSHEET_PACKS.nba.games[0].game.home.abbr, 'LAL')
  assert.equal(CHEATSHEET_PACKS.nhl.games[0].game.away.abbr, 'EDM')
  assert.equal(CHEATSHEET_PACKS.wnba.games[0].game.away.abbr, 'LVA')
  assert.equal(CHEATSHEET_PACKS.kbo.games[0].game.away.abbr, 'KIA')
  assert.match(proj, /LayoutToggle/)
  assert.match(proj, /sort-/)
  assert.match(sheets, /cheatsheet-filter-team/)
  assert.match(sheets, /cheatsheets-sport-/)
  assert.match(sheets, /loadLivePack/)
  assert.doesNotMatch(sheets, /packFor|CHEATSHEET_PACKS|EXAMPLE DATA/)
  assert.doesNotMatch(proj, /fetch\(|\/api\/|nflData|game_markets|cgScore/)
  assert.doesNotMatch(sheets, /cgScore/)
  assert.match(app, /cheatsheetGate/)
  assert.match(app, /canSeeCheatsheets\(user\)/)
  assert.match(app, /cheatsheets\/Cheatsheets/)
})

test('game tabs, column sort, and filters change the board', () => {
  const nba = CHEATSHEET_PACKS.nba.games
  assert.deepEqual(filterGames(nba, { team: 'lal' }).map((game) => game.id), ['nba-den-lal'])
  assert.deepEqual(filterGames(nba, { team: 'boston' }).map((game) => game.id), ['nba-bos-nyk'])
  assert.equal(filterGames(nba, { minEdge: 2 }).some((game) => game.id === 'nba-mil-chi'), false)
  const byEdge = sortGames(nba, toggleSort({ key: 'board', dir: 'asc' }, 'edge'))
  assert.equal(byEdge[0].id, 'nba-bos-nyk')
  assert.equal(byEdge[0].cg.total_edge, 6.1)
  const away = nba[0].matchups.away_off
  const tight = filterRows(away, '10')
  assert.equal(tight.length < away.length, true)
  assert.equal(tight.every((row) => Math.abs(row.edge) >= 10), true)
  assert.equal(sortRows(tight, { key: 'edge', dir: 'desc' })[0].stat, 'eFG %')
  assert.equal(visibleGames(nba, { team: 'zzzz' }, { key: 'board', dir: 'asc' }).length, 0)
})

test('live NFL game markets map published numbers and refuse a free preview', () => {
  assert.equal(liveNflPack({ preview: true, games: [{ awayTeam: 'DAL', homeTeam: 'PHI' }] }), null)
  assert.equal(liveNflPack({ games: [] }, { preview: true }), null)
  const pack = liveNflPack({
    week: 9,
    games: [{
      id: '2026-11-02-DAL-PHI',
      gameday: '2026-11-02',
      weekday: 'Sunday',
      gametime: '16:25',
      awayTeam: 'DAL',
      homeTeam: 'PHI',
      awayName: 'Cowboys',
      homeName: 'Eagles',
      awayScore: 22,
      homeScore: 28,
      spread: { line: 3.5, projection: 6, edge: -2.5, book: 'Circa' },
      total: { line: 47.5, projection: 50, edge: 2.5, book: 'Circa' },
      moneyline: { homePrice: -165, awayPrice: 140, book: 'Circa' },
    }],
  })
  assert.equal(pack.example, false)
  assert.equal(pack.weekLabel, 'NFL · Week 9')
  assert.equal(pack.games[0].cg.away_score, 22)
  assert.equal(pack.games[0].cg.total, 50)
  assert.equal(pack.games[0].cg.total_edge, 2.5)
  assert.equal(pack.games[0].cg.total_lean, 'OVER')
  assert.equal(pack.games[0].market.spread.favorite, 'PHI')
  assert.equal(pack.games[0].market.spread.line, -3.5)
  assert.equal(pack.games[0].cg.side_lean, 'PHI')
  assert.equal(pack.games[0].cg.side_proj, -6)
  assert.equal(pack.games[0].cg.side_edge, 2.5)
  assert.equal(pack.games[0].cg.cg_score_total, null)
  assert.equal(pack.games[0].cg.cg_score_spread, null)
  assert.equal(pack.games[0].matchups, null)
  assert.equal(pack.status, 'live')
  assert.equal(pack.model, 'game-markets')
  assert.equal(sourceLabel(pack), 'Live game markets')
  const withLineup = attachNflLineupContext(pack, [{
    awayTeam: 'DAL',
    homeTeam: 'PHI',
    awayRecord: '4-4',
    homeRecord: '6-2',
    roof: 'outdoors',
    spreadLine: -99,
    totalLine: 99,
  }])
  assert.equal(withLineup.games[0].game.away.record, '4-4')
  assert.equal(withLineup.games[0].game.home.record, '6-2')
  assert.equal(withLineup.games[0].game.surface, 'outdoors')
  assert.equal(withLineup.games[0].market.total, 47.5)
  assert.equal(withLineup.games[0].market.spread.line, -3.5)
  assert.equal(withLineup.games[0].cg.total, 50)
})

test('other sports use the published slate and leave team scores empty', () => {
  assert.equal(liveNbaPack({ preview: true, teams: [{ abbr: 'LAL', game: { home: true, opponent: 'DEN' } }] }), null)
  assert.equal(liveNbaPack({ teams: [] }), null)
  const nba = liveNbaPack({
    teams: [
      { abbr: 'DEN', fullName: 'Denver Nuggets', color: '0E2240', game: { date: '2026-11-02', opponent: 'LAL', home: false, tip: '2026-11-02T02:00:00Z' } },
      { abbr: 'LAL', fullName: 'Los Angeles Lakers', color: '#552583', game: { date: '2026-11-02', opponent: 'DEN', home: true, tip: '2026-11-02T02:00:00Z' } },
    ],
  })
  assert.equal(nba.example, false)
  assert.equal(nba.model, 'slate')
  assert.equal(nba.games.length, 1)
  assert.equal(nba.games[0].game.away.abbr, 'DEN')
  assert.equal(nba.games[0].game.home.abbr, 'LAL')
  assert.equal(nba.games[0].game.home.color, '#552583')
  assert.equal(nba.games[0].cg.total, null)
  assert.equal(nba.games[0].cg.away_score, null)
  assert.equal(nba.games[0].market.total, null)
  assert.equal(nba.detailNote, LIVE_GAPS.nba)
  assert.notEqual(nba.games[0].id, 'nba-den-lal')

  const nhl = liveNhlPack({
    lineupsLoaded: true,
    lineups: [{
      gameday: '2026-10-27',
      weekday: 'Monday',
      gametime: '7:00 PM ET',
      start_time: '2026-10-27T23:00:00Z',
      awayTeam: 'EDM',
      homeTeam: 'CGY',
      awayName: 'Oilers',
      homeName: 'Flames',
    }],
  })
  assert.equal(nhl.example, false)
  assert.equal(nhl.games[0].game.away.abbr, 'EDM')
  assert.equal(nhl.games[0].game.home.name, 'Flames')
  assert.equal(nhl.games[0].cg.total, null)
  assert.equal(nhl.games[0].market.total, null)
  assert.equal(liveNhlPack({ lineupsLoaded: true, lineups: [], projections: [{ awayTeam: 'BOS', homeTeam: 'NYR' }] }), null)
  const fromProps = liveNhlPack({
    lineupsLoaded: false,
    projections: [{ awayTeam: 'BOS', homeTeam: 'NYR', gameday: '2026-10-28', start_time: '2026-10-28T23:00:00Z' }],
  })
  assert.equal(fromProps.games[0].game.away.abbr, 'BOS')
  assert.equal(fromProps.games[0].cg.home_score, null)
  assert.equal(liveNhlPack({ projectionsPreview: true, projections: [{ awayTeam: 'BOS', homeTeam: 'NYR' }] }), null)

  const wnba = liveWnbaPack({
    lineups: [{ gameTime: '7:00 PM ET', visitor: { abbr: 'LVA', name: 'Aces' }, home: { abbr: 'NYL', name: 'Liberty' } }],
  })
  assert.equal(wnba.example, false)
  assert.equal(wnba.weekLabel, 'WNBA · live slate')
  assert.equal(wnba.games[0].game.away.abbr, 'LVA')
  assert.equal(wnba.games[0].game.home.abbr, 'NYL')
  assert.equal(wnba.games[0].listKick, '7:00 PM ET')
  assert.equal(wnba.games[0].cg.total, null)
  assert.equal(wnba.detailNote, LIVE_GAPS.wnba)
  assert.equal(liveWnbaPack({ preview: true, lineups: [{ visitor: { abbr: 'LVA' }, home: { abbr: 'NYL' } }] }), null)
  assert.equal(liveWnbaPack({ lineups: [] }), null)

  const kbo = liveKboPack({
    matchups: {
      game_date: '2026-10-27',
      matchups: [{
        away: 'Kia',
        home: 'LG',
        stadium: 'Jamsil Baseball Stadium',
        market: {
          total: 8.5,
          spread: { away: 1.5, home: -1.5 },
          moneyline: { away: 130, home: -150 },
        },
      }],
    },
  })
  assert.equal(kbo.example, false)
  assert.equal(kbo.weekLabel, 'KBO · 2026-10-27')
  assert.equal(kbo.games[0].game.away.abbr, 'KIA')
  assert.equal(kbo.games[0].game.home.abbr, 'LG')
  assert.equal(kbo.games[0].game.venue, 'Jamsil Baseball Stadium')
  assert.equal(kbo.games[0].market.total, 8.5)
  assert.equal(kbo.games[0].market.spread.favorite, 'LG')
  assert.equal(kbo.games[0].market.spread.line, -1.5)
  assert.equal(kbo.games[0].market.ml.LG, -150)
  assert.equal(kbo.games[0].cg.total, null)
  assert.equal(kbo.games[0].cg.away_score, null)
  assert.equal(kbo.games[0].cg.cg_score_total, null)
  assert.equal(kbo.detailNote, LIVE_GAPS.kbo)
  const fromLines = liveKboPack({
    matchups: { matchups: [{ away: 'Doosan', home: 'Samsung' }] },
    lines: { games: [{ away: 'Doosan', home: 'Samsung', total: 9.5, spread: { away: -1.5, home: 1.5 }, moneyline: { away: -140, home: 120 } }] },
  })
  assert.equal(fromLines.games[0].market.total, 9.5)
  assert.equal(fromLines.games[0].market.spread.favorite, 'DOO')
  assert.equal(fromLines.games[0].cg.total, null)
  assert.equal(liveKboPack({ preview: true, matchups: { matchups: [{ away: 'Kia', home: 'LG' }] } }), null)

  const empty = unavailablePack('nba', UNAVAILABLE_NOTES.nbaEmpty)
  assert.equal(empty.example, false)
  assert.equal(empty.status, 'unavailable')
  assert.equal(empty.games.length, 0)
  assert.match(empty.detailNote, /not used as a game total/)
  assert.equal(waitingPack('nhl').status, 'waiting')
  assert.equal(sourceLabel(waitingPack('nhl')), 'Loading live board')
  assert.equal(sourceLabel(CHEATSHEET_PACKS.nba), 'Example sheet')
  assert.equal(sourceLabel(empty), 'Live board unavailable')
})

test('example chart and heat colors match the locked draft', () => {
  assert.equal(signed1(3), '+3.0')
  assert.equal(signed1(-5.7), '-5.7')
  assert.equal(moneyline(140), '+140')
  assert.equal(moneyline(-165), '-165')
  assert.equal(chartPct(41), 29.7)
  assert.equal(chartPct(47.5), 47.3)
  assert.equal(heatColor(71), '#4ade80')
  assert.equal(heatColor(64), '#86efac')
  assert.equal(heatColor(48), '#d4d4d8')
  assert.equal(heatColor(42), '#fca5a5')
  assert.equal(heatColor(33), '#f87171')
  assert.equal(formatStat('OPS', 0.782), '0.782')
  assert.equal(formatStat('EPA / Play', 0.08), '0.08')
  assert.equal(chartPct(224.5, 190, 70), 49.3)
})

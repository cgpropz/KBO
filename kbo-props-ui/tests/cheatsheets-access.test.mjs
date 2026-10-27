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
import { liveNflPack } from '../src/cheatsheets/nflGameSheet.js'
import { filterGames, filterRows, sortGames, sortRows, toggleSort, visibleGames } from '../src/cheatsheets/boardControls.js'

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

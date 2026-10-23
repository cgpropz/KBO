// NHL player page parity helpers. Made-up players and games only.
import test from 'node:test'
import assert from 'node:assert/strict'
import { cgScore } from '../src/cgScore.js'
import { buildSplits, metricWindows } from '../src/playerInsights/insightsCore.js'
import { HISTORY_KEYS, stripBoardHistory } from '../api/_boardPayload.js'
import {
  NHL_API_SECTIONS_APPROVED, PENDING, MONEYPUCK_ONLY, anyNarrowed, apiWindow, applyFilters, decodeNhlApiLog,
  filterBounds, filtersFor, formatIceMinutes, nhlApiInsights, nhlApiSectionsOn, nhlTodayPick, nhlTrendSummary,
  playerPropRows, resolveFilters, SKATER_TRENDS, GOALIE_TRENDS, nhlSeasonFor, nhlSeasons, nhlPlayed,
} from '../src/nhl/nhlPlayerParity.js'

// Fixed so the tests do not move with the calendar.
const SEASONS = { current: '2026-27', prior: '2025-26' }

const COLS = ['d', 's', 'opp', 'h', 'res', 'g', 'a', 'pts', 'sog', 'ppg', 'ppp', 'toi', 'ev', 'pp', 'sh', 'shf', 'hit', 'blk', 'fow', 'fot']

function skaterLog(rows) {
  return { v: 1, source: 'api.nhle.com/stats/rest', kind: 'skater', cols: COLS, games: rows }
}

// date, season, opp, home, result, goals, assists, sog, ppp, toi sec, pp sec
function g(d, s, opp, h, res, goals, assists, sog, ppp, toi, pp, fow = 0, fot = 0) {
  return [d, s, opp, h, res, goals, assists, goals + assists, sog, 0, ppp, toi, toi - pp - 30, pp, 30, 22, 2, 1, fow, fot]
}

const LOG = skaterLog([
  g('2026-10-03', '2026-27', 'TST', 1, 'W', 1, 0, 3, 0, 1080, 120),
  g('2026-10-22', '2026-27', 'FAK', 0, 'L', 0, 1, 5, 1, 1260, 240, 6, 10),
  g('2026-10-20', '2026-27', 'TST', 1, 'OTL', 2, 1, 4, 2, 1200, 180, 4, 10),
  g('2026-10-17', '2026-27', 'MOK', 1, 'W', 0, 0, 1, 0, 960, 0),
  g('2026-10-12', '2026-27', 'FAK', 0, 'W', 0, 2, 2, 1, 1140, 150),
  g('2026-04-10', '2025-26', 'MOK', 0, 'L', 1, 1, 2, 0, 1020, 60),
])

test('the NHL API sections are off by default and only a dev build can preview them', () => {
  assert.equal(NHL_API_SECTIONS_APPROVED, false)
  assert.equal(nhlApiSectionsOn({ dev: false, search: '?nhlApiPreview=1' }), false)
  assert.equal(nhlApiSectionsOn({ dev: true, search: '' }), false)
  assert.equal(nhlApiSectionsOn({ dev: true, search: '?nhlApiPreview=1' }), true)
  assert.equal(nhlApiSectionsOn({ approved: true, dev: false }), true)
})

test('pick card uses the board CG Score and shows Pending, never 0', () => {
  const pick = nhlTodayPick({ prop: 'Shots On Goal', line: 2.5, projection: 3.1 })
  assert.equal(pick.projection, 3.1)
  assert.equal(pick.cg, cgScore(3.1, 2.5, 'Shots On Goal'))
  assert.equal(pick.side, 'OVER')
  assert.equal(nhlTodayPick({ prop: 'Points', line: 0.5, projection: 0.3 }).side, 'UNDER')
  for (const blank of [null, '', 0, -1, 'abc']) {
    const held = nhlTodayPick({ prop: 'Points', line: 0.5, projection: blank })
    assert.equal(held.projection, null)
    assert.equal(held.cg, null)
  }
  const noLine = nhlTodayPick({ prop: 'Points', line: null, projection: 1.2 })
  assert.equal(noLine.cg, null)
  assert.equal(noLine.projection, null)
  assert.equal(PENDING, 'Pending')
})

test('stat chips are standard lines only; a prop with only goblin/demon lines has no chip', () => {
  const rows = playerPropRows([
    { player: 'Test Skater', prop: 'Points', line: 0.5, oddsType: 'demon' },
    { player: 'Test Skater', prop: 'Points', line: 1.5, oddsType: 'standard' },
    { player: 'Test Skater', prop: 'Shots On Goal', line: 2.5 },
    { player: 'Test Skater', prop: 'Power Play Points', line: 0.5, oddsType: 'demon' },
    { player: 'Test Skater', prop: 'Goalie Saves', line: 20.5, odds_type: 'goblin' },
    { player: 'Test Skater', prop: 'Blocked Shots', line: 1.5, oddsType: '' },
    { player: 'Someone Else', prop: 'Power Play Points', line: 0.5 },
  ], 'Test Skater')
  assert.deepEqual(rows.map((row) => [row.prop, row.line]), [['Shots On Goal', 2.5], ['Points', 1.5]])
})

test('season labels come from the date, not a constant', () => {
  assert.equal(nhlSeasonFor('2026-10-12'), '2026-27')
  assert.equal(nhlSeasonFor('2027-04-10'), '2026-27')
  assert.equal(nhlSeasonFor('2027-08-01'), '2027-28')
  assert.equal(nhlSeasonFor('nope'), null)
  assert.deepEqual(nhlSeasons(new Date(2026, 9, 23)), { current: '2026-27', prior: '2025-26' })
  assert.deepEqual(nhlSeasons(new Date(2028, 0, 5)), { current: '2027-28', prior: '2026-27' })
  // A log row's season string is replaced by the one its date implies.
  const [game] = decodeNhlApiLog(skaterLog([g('2027-10-15', '2026-27', 'TST', 1, 'W', 0, 0, 1, 0, 900, 0)]))
  assert.equal(game.season, '2027-28')
})

test('0-TOI games count nowhere: trends, hit rates, splits, early-season count', () => {
  const zero = decodeNhlApiLog(skaterLog([g('2026-10-23', '2026-27', 'FAK', 1, 'W', 0, 0, 0, 0, 0, 0)]))[0]
  assert.equal(zero.played, false)
  assert.equal(nhlPlayed(GAMES[0]), true)
  const withZero = [zero, ...GAMES]
  const opts = { prop: 'Shots On Goal', opponent: 'FAK', seasons: SEASONS }
  assert.equal(apiWindow(withZero, 'season', opts).length, 5)
  assert.equal(apiWindow(withZero, 'h2h', opts).length, 2)
  assert.ok(!apiWindow(withZero, 'l5', opts).some((bar) => bar.date === '2026-10-23'))
  const sog = SKATER_TRENDS.find((metric) => metric.id === 'sog')
  assert.deepEqual(nhlTrendSummary(withZero, sog, { seasons: SEASONS }), nhlTrendSummary(GAMES, sog, { seasons: SEASONS }))
  const model = nhlApiInsights({ prop: 'Shots On Goal', opponent: 'FAK' }, withZero, { seasons: SEASONS })
  assert.equal(model.games[0].played, false)
  const splits = buildSplits(model.games, { ...model, line: 2.5, today: model.games[1].day })
  const season = splits.rows.find((row) => row.id === 'season')
  assert.equal(season.n, 5)
  assert.equal(splits.rows.find((row) => row.id === 'vsopp').n, 2)
})

test('decodes the columnar NHL API log newest first with TOI in minutes', () => {
  const games = decodeNhlApiLog(LOG)
  assert.equal(games.length, 6)
  assert.equal(games[0].date, '2026-10-22')
  const latest = games.find((game) => game.date === '2026-10-22')
  assert.equal(latest.toi, 21)
  assert.equal(latest.pp, 4)
  assert.equal(latest.home, false)
  assert.equal(latest.sog, 5)
  assert.deepEqual(decodeNhlApiLog(null), [])
  assert.deepEqual(decodeNhlApiLog({ cols: 'x', games: [] }), [])
})

const GAMES = decodeNhlApiLog(LOG).filter((game) => game.season === '2026-27')
  .concat(decodeNhlApiLog(LOG).filter((game) => game.season === '2025-26'))

test('TOI and PP TOI sliders narrow the games the chart uses', () => {
  const filters = filtersFor('skater')
  assert.deepEqual(filters.map((filter) => filter.id), ['toi', 'pp'])
  assert.deepEqual(filtersFor('goalie').map((filter) => filter.id), ['toi'])
  const bounds = filterBounds(GAMES, filters)
  assert.deepEqual([bounds.toi.min, bounds.toi.max], [16, 21])
  const open = resolveFilters(bounds, {}, filters)
  assert.equal(anyNarrowed(open), false)
  assert.equal(applyFilters(GAMES, open, filters).length, GAMES.length)
  const narrowed = resolveFilters(bounds, { pp: { low: 3, high: 4 } }, filters)
  assert.equal(anyNarrowed(narrowed), true)
  const kept = applyFilters(GAMES, narrowed, filters)
  assert.deepEqual(kept.map((game) => game.date), ['2026-10-22', '2026-10-20'])
  const bars = apiWindow(kept, 'l10', { prop: 'Shots On Goal' })
  assert.deepEqual(bars.map((bar) => bar.value), [4, 5])
})

test('hit-rate windows read the prop from the NHL API games', () => {
  const opts = { prop: 'Power Play Points', opponent: 'FAK', seasons: SEASONS }
  assert.equal(apiWindow(GAMES, 'season', opts).length, 5)
  assert.equal(apiWindow(GAMES, 'prior', opts).length, 1)
  assert.deepEqual(apiWindow(GAMES, 'h2h', opts).map((bar) => bar.value), [1, 1])
  assert.deepEqual(apiWindow(GAMES, 'l5', opts).map((bar) => bar.date), ['2026-10-03', '2026-10-12', '2026-10-17', '2026-10-20', '2026-10-22'])
})

test('trend arrow waits for 5 games this season, then compares L5 with this season', () => {
  const toi = SKATER_TRENDS.find((metric) => metric.id === 'toi')
  const four = nhlTrendSummary(GAMES.filter((game) => game.date !== '2026-10-03'), toi, { seasons: SEASONS })
  assert.equal(four.seasonGames, 4)
  assert.equal(four.trend, null)
  const five = nhlTrendSummary(GAMES, toi, { seasons: SEASONS })
  assert.equal(five.seasonGames, 5)
  assert.equal(five.trend, 'flat') // L5 is this season's 5 games
  assert.equal(formatIceMinutes(five.l5), '18:48')
  assert.deepEqual(GOALIE_TRENDS.map((metric) => metric.id), ['toi', 'sa', 'sv'])
})

test('splits and advanced use NHL stats and list MoneyPuck-only stats as unavailable', () => {
  const model = nhlApiInsights({ prop: 'Shots On Goal', opponent: 'FAK' }, GAMES, { seasons: SEASONS })
  assert.equal(model.earlySeasonGames, 10)
  assert.equal(model.logCap, 60)
  assert.equal(model.splitsBlocked, null)
  const ids = model.metrics.map((metric) => metric.id)
  assert.deepEqual(ids, ['shPct', 'sog60', 'ppPts', 'evToi', 'ppToi', 'shToi', 'ppShare', 'foPct', 'blocks', 'hits', 'pts60', 'shifts'])
  assert.ok(model.unavailable.every((text) => /MoneyPuck only/.test(text)))
  assert.deepEqual(model.unavailable, MONEYPUCK_ONLY.skater)
  const splits = buildSplits(model.games, { ...model, line: 2.5, today: model.games[0].day })
  const byId = Object.fromEntries(splits.rows.map((row) => [row.id, row]))
  assert.equal(byId.home.n, 3)
  assert.equal(byId.away.n, 3)
  assert.equal(byId.vsopp.n, 2)
  assert.equal(byId.losses.n, 3) // the OT loss counts as a loss
  const shPct = model.metrics.find((metric) => metric.id === 'shPct')
  const season = metricWindows(shPct, model.games, model).find((window) => window.id === 'season')
  assert.equal(season.value, 3 / 15)
  const fo = model.metrics.find((metric) => metric.id === 'foPct')
  assert.equal(metricWindows(fo, model.games, model).find((window) => window.id === 'season').value, 0.5)

  const noFaceoffs = nhlApiInsights({ prop: 'Points' }, GAMES.map((game) => ({ ...game, fot: 0, fow: 0 })), { seasons: SEASONS })
  assert.ok(!noFaceoffs.metrics.some((metric) => metric.id === 'foPct'))
  assert.ok(nhlApiInsights({ prop: 'Points' }, [], { seasons: SEASONS }).splitsBlocked)
})

test('goalies get save stats and goalie-only unavailable notes', () => {
  const games = decodeNhlApiLog({
    kind: 'goalie',
    cols: ['d', 's', 'opp', 'h', 'res', 'sa', 'sv', 'ga', 'toi'],
    games: [['2026-10-20', '2026-27', 'TST', 1, 'W', 30, 28, 2, 3600], ['2026-10-18', '2026-27', 'FAK', 0, 'OTL', 20, 17, 3, 3700]],
  })
  const model = nhlApiInsights({ prop: 'Goalie Saves' }, games, { seasons: SEASONS })
  assert.deepEqual(model.metrics.map((metric) => metric.id), ['svPct', 'gaa', 'saves', 'sa'])
  assert.deepEqual(model.unavailable, MONEYPUCK_ONLY.goalie)
  assert.deepEqual(model.games.map((game) => game.value), [28, 17])
})

test('board responses drop nhlApiLog; it ships only with a player request', () => {
  assert.ok(HISTORY_KEYS.includes('nhlApiLog'))
  const [row] = stripBoardHistory([{ player: 'Test Skater', prop: 'Points', line: 0.5, nhlApiLog: LOG }])
  assert.equal(row.nhlApiLog, undefined)
  assert.equal(row.player, 'Test Skater')
})

test('NHL stat directions and position baselines for the shared scale', async () => {
  const { NHL_STAT_DIRECTIONS, nhlBaseline, nhlBaselineGroup } = await import('../src/nhl/nhlStatScale.js')
  for (const id of ['gaa', 'goalsAgainst', 'giveaways', 'pim', 'oppDefRank']) assert.equal(NHL_STAT_DIRECTIONS[id], 'lower')
  for (const id of ['sog', 'pts', 'ppp', 'sv', 'shPct', 'svPct']) assert.equal(NHL_STAT_DIRECTIONS[id], 'higher')
  assert.equal(nhlBaselineGroup({ position: 'D' }), 'D')
  assert.equal(nhlBaselineGroup({ prop: 'Goalie Saves' }), 'G')
  assert.equal(nhlBaselineGroup({ position: 'C' }), 'F')
  assert.ok(nhlBaseline('shPct', 'F') > nhlBaseline('shPct', 'D'))
  assert.ok(nhlBaseline('blocks', 'D') > nhlBaseline('blocks', 'F'))
  assert.equal(nhlBaseline('foPct', 'D'), nhlBaseline('foPct', 'F'))
  assert.equal(nhlBaseline('nope', 'F'), null)
  const model = nhlApiInsights({ prop: 'Shots On Goal', position: 'D' }, GAMES, { seasons: SEASONS })
  assert.equal(model.better, 'higher')
  assert.equal(model.baselineGroup, 'D')
  const shPct = model.metrics.find((metric) => metric.id === 'shPct')
  assert.equal(shPct.better, 'higher')
  assert.equal(shPct.baseline.group, 'D')
  assert.equal(shPct.baseline.value, nhlBaseline('shPct', 'D'))
  const goalie = nhlApiInsights({ prop: 'Goalie Saves' }, GAMES.map((game) => ({ ...game, kind: 'goalie' })), { seasons: SEASONS })
  assert.equal(goalie.metrics.find((metric) => metric.id === 'gaa').better, 'lower')
  assert.equal(goalie.metrics.find((metric) => metric.id === 'sa').better, 'neutral')
})

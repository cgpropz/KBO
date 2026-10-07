import assert from 'node:assert/strict'
import test from 'node:test'
import {
  buildPropRows,
  computeH2H,
  dvpGrade,
  filterAndSortRows,
  DEFAULT_FILTERS,
  nbaLogoUrl,
  opponentFromMatchup,
} from '../src/nba/nbaPropLines.js'

function game(points, extra = {}) {
  return {
    pts: points,
    reb: extra.reb ?? 4,
    ast: extra.ast ?? 3,
    fg3m: extra.fg3m ?? 1,
    stl: extra.stl ?? 1,
    blk: extra.blk ?? 0,
    tov: extra.tov ?? 2,
    matchup: extra.matchup ?? 'ATL vs. BOS',
  }
}

test('opponent comes from the side after vs or @', () => {
  assert.equal(opponentFromMatchup('TOR vs. BKN'), 'BKN')
  assert.equal(opponentFromMatchup('MIL @ PHI'), 'PHI')
  assert.equal(opponentFromMatchup('LAL vs SAC'), 'SAC')
})

test('head to head does not treat SA as part of SAC', () => {
  const games = [
    game(20, { matchup: 'LAL vs. SAC' }),
    game(30, { matchup: 'LAL @ SA' }),
  ]
  const sac = computeH2H(games, 'Points', 25, 'SAC')
  const sa = computeH2H(games, 'Points', 25, 'SA')
  assert.equal(sac.total, 1)
  assert.equal(sac.hits, 0)
  assert.equal(sa.total, 1)
  assert.equal(sa.hits, 1)
})

test('board rows use the roster log for the chart and skip lines with no projection', () => {
  const projections = [{
    athleteId: '1',
    name: 'Trae Young',
    team: 'ATL',
    position: '',
    ppAllProps: [
      { stat: 'Points', line: 25.5, projection: 28, opponent: 'BOS', effectiveDvpRank: 24, hitRates: { L10: 40, FULL: 40 } },
      { stat: 'Points - 1st 3 Minutes', line: 2.5, projection: 3, opponent: 'BOS' },
      { stat: 'Rebounds', line: 3.5, projection: null, opponent: 'BOS' },
    ],
  }]
  const players = [{
    athleteId: '1',
    name: 'Trae Young',
    team: 'ATL',
    position: 'PG',
    image: 'https://example.com/trae.png',
    gameLogs: [game(30), game(28), game(22), game(31), game(27), game(19), game(26), game(24), game(29), game(21), game(18)],
  }]
  const rows = buildPropRows(projections, players)
  assert.equal(rows.length, 1)
  const row = rows[0]
  assert.equal(row.position, 'PG')
  assert.equal(row.imageUrl, 'https://example.com/trae.png')
  assert.equal(row.recent.length, 10)
  assert.equal(row.recent[0], 21)
  assert.equal(row.recent.at(-1), 30)
  assert.equal(row.hitRate, 60)
  assert.equal(row.isOver, true)
  assert.equal(row.score.toFixed(1), '54.9')
  assert.equal(dvpGrade(row.dvpRank), 'A')
})

test('offensive rebounds chart from the saved last-10 when the roster log dropped them', () => {
  const projections = [{
    name: 'Clint Capela',
    team: 'ATL',
    position: 'C',
    gp: 8,
    ppAllProps: [{
      stat: 'Offensive Rebounds',
      line: 3.5,
      projection: 4.1,
      opponent: 'NY',
      effectiveDvpRank: 4,
      hitRates: { L10: 62.4, FULL: 55 },
      l10Values: [5, 4, 2, 6, 1, 3, 4, 0],
    }],
  }]
  const players = [{
    name: 'Clint Capela',
    team: 'ATL',
    position: 'C',
    gp: 8,
    gameLogs: [game(10, { matchup: 'ATL @ NY' })],
  }]
  const [row] = buildPropRows(projections, players)
  assert.deepEqual(row.recent, [0, 4, 3, 1, 6, 2, 4, 5])
  assert.equal(row.hitRate, 50)
  assert.equal(row.seasonHitRate, 55)
  assert.equal(row.h2hHitRate, null)
  assert.equal(row.gamesPlayed, 8)
})

test('a roster log that kept offensive rebounds charts those games', () => {
  const projections = [{
    name: 'Clint Capela',
    team: 'ATL',
    position: 'C',
    ppAllProps: [{
      stat: 'Offensive Rebounds',
      line: 2.5,
      projection: 3,
      opponent: 'BOS',
      l10Values: [9, 9],
    }],
  }]
  const players = [{
    name: 'Clint Capela',
    team: 'ATL',
    gameLogs: [
      { ...game(10, { matchup: 'ATL vs. BOS' }), oreb: 4 },
      { ...game(8, { matchup: 'ATL @ NY' }), oreb: 1 },
    ],
  }]
  const [row] = buildPropRows(projections, players)
  assert.deepEqual(row.recent, [1, 4])
  assert.equal(row.hitRate, 50)
  assert.equal(row.h2hHitRate, 100)
})

test('filters keep one prop type and sort by last-10 hit rate', () => {
  const projections = [{
    name: 'A',
    team: 'BOS',
    position: 'SF',
    ppAllProps: [
      { stat: 'Points', line: 20, projection: 22, opponent: 'MIA', hitRates: { L10: 40 } },
      { stat: 'Rebounds', line: 8, projection: 7, opponent: 'MIA', hitRates: { L10: 80 } },
    ],
  }, {
    name: 'B',
    team: 'MIA',
    position: 'PG',
    ppAllProps: [
      { stat: 'Points', line: 18, projection: 21, opponent: 'BOS', hitRates: { L10: 90 } },
    ],
  }]
  const rows = filterAndSortRows(buildPropRows(projections, []), 'Points', DEFAULT_FILTERS)
  assert.deepEqual(rows.map((row) => row.player), ['B', 'A'])
  assert.equal(nbaLogoUrl('NY'), 'https://a.espncdn.com/i/teamlogos/nba/500/ny.png')
  assert.equal(dvpGrade(30), 'A+')
  assert.equal(dvpGrade(1)[0], 'D')
})

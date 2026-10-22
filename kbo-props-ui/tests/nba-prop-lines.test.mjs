import assert from 'node:assert/strict'
import test from 'node:test'
import {
  buildPropRows,
  cgBoundInput,
  cgBoundsAfterEdit,
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

test('NBA hit rate leaves a push out of the sample', () => {
  const games = [game(25), game(30), game(10)]
  const rated = computeH2H(games, 'Points', 25, 'BOS')
  assert.equal(rated.hits, 1)
  assert.equal(rated.total, 2)
  assert.equal(rated.pct, 50)
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
  const rows = filterAndSortRows(buildPropRows(projections, []), 'Points', { ...DEFAULT_FILTERS, sortBy: 'L10 Hit Rate' })
  assert.deepEqual(rows.map((row) => row.player), ['B', 'A'])
  assert.equal(nbaLogoUrl('NY'), 'https://a.espncdn.com/i/teamlogos/nba/500/ny.png')
  assert.equal(dvpGrade(30), 'A+')
  assert.equal(dvpGrade(1)[0], 'D')
})

test('NBA board score is bounded 0-100 like KBO and NFL', () => {
  const projections = [{
    athleteId: '9',
    name: 'Bound Test',
    team: 'PHI',
    position: 'SG',
    ppAllProps: [
      { stat: 'Assists', line: 2.5, projection: 5.68, opponent: 'NY', hitRates: { L10: 60, FULL: 60 } },
      { stat: 'Points', line: 4.5, projection: 8.83, opponent: 'NY', hitRates: { L10: 60, FULL: 60 } },
    ],
  }]
  const rows = buildPropRows(projections, [])
  const byStat = Object.fromEntries(rows.map((row) => [row.prop, row.score]))
  assert.equal(byStat.Assists, 100)
  assert.equal(byStat.Points.toFixed(1), '98.1')
})

function minutesRow({ player, prop = 'Points', avgMins, score, side = 'OVER' }) {
  return {
    player,
    prop,
    avgMins,
    score,
    _rawScore: score,
    side,
    hitRate: 80,
    gamesPlayed: 10,
    position: 'PG',
    line: 10,
    seasonHitRate: 50,
    h2hHitRate: 40,
    dvpRank: 8,
  }
}

test('minutes buckets round before they compare, and blank minutes stay on All', () => {
  const rows = [
    minutesRow({ player: 'Just Under', avgMins: 19.6, score: 10 }),
    minutesRow({ player: 'Thirty', avgMins: 29.5, score: 20 }),
    minutesRow({ player: 'Low', avgMins: 19.4, score: 30 }),
    minutesRow({ player: 'Blank', avgMins: null, score: 90 }),
    minutesRow({ player: 'Empty', avgMins: '', score: 80 }),
    minutesRow({ player: 'Nan', avgMins: NaN, score: 70 }),
    minutesRow({ player: 'Space', prop: 'Rebounds', avgMins: '   ', score: 60 }),
  ]
  const names = (minutes) => filterAndSortRows(rows, 'All Props', { ...DEFAULT_FILTERS, minutes }).map((row) => row.player)
  assert.deepEqual(names('All'), ['Blank', 'Empty', 'Nan', 'Space', 'Low', 'Thirty', 'Just Under'])
  assert.deepEqual(names('30+'), ['Thirty'])
  assert.deepEqual(names('20+'), ['Thirty', 'Just Under'])
  assert.deepEqual(names('Under 20'), ['Low'])
})

test('minutes sort is high to low with blank minutes last', () => {
  const rows = [
    minutesRow({ player: 'Mid', avgMins: 19.6, score: 99 }),
    minutesRow({ player: 'Blank', avgMins: null, score: 100 }),
    minutesRow({ player: 'Top', avgMins: 34.2, score: 10 }),
    minutesRow({ player: 'Thirty', avgMins: 29.5, score: 50 }),
    minutesRow({ player: 'Tied High', avgMins: 22, score: 80 }),
    minutesRow({ player: 'Tied Low', avgMins: 22, score: 15 }),
    minutesRow({ player: 'Empty', prop: 'Rebounds', avgMins: '', score: 70 }),
  ]
  const byMinutes = filterAndSortRows(rows, 'All Props', { ...DEFAULT_FILTERS, sortBy: 'Minutes high to low' })
  assert.deepEqual(byMinutes.map((row) => row.player), ['Top', 'Thirty', 'Tied High', 'Tied Low', 'Mid', 'Blank', 'Empty'])
  const byScore = filterAndSortRows(rows, 'All Props', { ...DEFAULT_FILTERS, sortBy: 'CG Score' })
  assert.deepEqual(byScore.map((row) => row.player), ['Blank', 'Mid', 'Tied High', 'Empty', 'Thirty', 'Tied Low', 'Top'])
})

test('CG Score bounds clamp to 0-100, keep min at or below max, and ignore an empty box', () => {
  assert.equal(cgBoundInput(''), '')
  assert.equal(cgBoundInput('   '), '')
  assert.equal(cgBoundInput('nope'), '')
  assert.equal(cgBoundInput('150'), '100')
  assert.equal(cgBoundInput('-4'), '0')
  assert.equal(cgBoundInput('60.5'), '60.5')
  assert.deepEqual(cgBoundsAfterEdit({ edgeMin: '', edgeMax: '40' }, 'edgeMin', '70'), { edgeMin: '70', edgeMax: '70' })
  assert.deepEqual(cgBoundsAfterEdit({ edgeMin: '80', edgeMax: '' }, 'edgeMax', '30'), { edgeMin: '30', edgeMax: '30' })
  assert.deepEqual(cgBoundsAfterEdit({ edgeMin: '20', edgeMax: '90' }, 'edgeMax', ''), { edgeMin: '20', edgeMax: '' })

  const rows = [
    minutesRow({ player: 'Top', avgMins: 34, score: 100 }),
    minutesRow({ player: 'Inside', avgMins: 33, score: 72 }),
    minutesRow({ player: 'Low', avgMins: 31, score: 40 }),
    minutesRow({ player: 'Short Shift', prop: 'Rebounds', avgMins: 12, score: 72 }),
  ]
  const ranged = filterAndSortRows(rows, 'All Props', { ...DEFAULT_FILTERS, edgeMin: '60', edgeMax: '80', minutes: '30+' })
  assert.deepEqual(ranged.map((row) => row.player), ['Inside'])
  const openMax = filterAndSortRows(rows, 'Points', { ...DEFAULT_FILTERS, edgeMin: '60', edgeMax: '' })
  assert.deepEqual(openMax.map((row) => row.player), ['Top', 'Inside'])
  const clamped = filterAndSortRows(rows, 'All Props', { ...DEFAULT_FILTERS, edgeMin: '150', edgeMax: '-3' })
  assert.deepEqual(clamped.map((row) => row.player), ['Top', 'Inside', 'Short Shift', 'Low'])
})

test('minutes filter and sort compose with a stat chip', () => {
  const rows = [
    minutesRow({ player: 'Points High', prop: 'Points', avgMins: 33, score: 40 }),
    minutesRow({ player: 'Points Low', prop: 'Points', avgMins: 12, score: 90 }),
    minutesRow({ player: 'Points Blank', prop: 'Points', avgMins: null, score: 95 }),
    minutesRow({ player: 'Boards High', prop: 'Rebounds', avgMins: 36, score: 70 }),
    minutesRow({ player: 'Points Twenty', prop: 'Points', avgMins: 19.6, score: 20 }),
  ]
  const points = filterAndSortRows(rows, 'Points', {
    ...DEFAULT_FILTERS,
    minutes: '20+',
    sortBy: 'Minutes high to low',
  })
  assert.deepEqual(points.map((row) => row.player), ['Points High', 'Points Twenty'])
})

test('rows tied at the 100 cap sort by the uncapped score, not feed order', () => {
  const projections = [{
    athleteId: '10',
    name: 'Tie Test',
    team: 'PHI',
    position: 'SG',
    ppAllProps: [
      { stat: 'Turnovers', line: 2.5, projection: 5.1, opponent: 'NY', hitRates: { L10: 60, FULL: 60 } },
      { stat: 'Assists', line: 2.5, projection: 5.68, opponent: 'NY', hitRates: { L10: 60, FULL: 60 } },
    ],
  }]
  const rows = buildPropRows(projections, [])
  const sorted = filterAndSortRows(rows, 'All Props', { ...DEFAULT_FILTERS, sortBy: 'CG Score' })
  assert.deepEqual(sorted.map((row) => row.score), [100, 100])
  assert.deepEqual(sorted.map((row) => row.prop), ['Assists', 'Turnovers'])
})

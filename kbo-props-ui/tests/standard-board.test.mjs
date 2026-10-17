import assert from 'node:assert/strict'
import test from 'node:test'
import { FILTER_STANDARD_BEFORE_FREE_PREVIEW, shapeForTier } from '../api/_dataAccess.js'
import { filterStandardBoard, isStandardBoardLine, rawOddsType } from '../src/standardBoard.js'

test('raw odds type keeps unknown tokens and blank stays empty', () => {
  assert.equal(rawOddsType({ odds_type: ' Goblin ' }), 'goblin')
  assert.equal(rawOddsType({ oddsType: 'DEMON' }), 'demon')
  assert.equal(rawOddsType({ line_type: 'standard' }), 'standard')
  assert.equal(rawOddsType({ lineType: 'mystery' }), 'mystery')
  assert.equal(rawOddsType({ odds_type: '  ' }), '')
  assert.equal(rawOddsType({}), '')
  assert.equal(isStandardBoardLine({ oddsType: 'standard' }), true)
  assert.equal(isStandardBoardLine({}), true)
  assert.equal(isStandardBoardLine({ odds_type: null }), true)
  assert.equal(isStandardBoardLine({ odds_type: '  ' }), false)
  assert.equal(isStandardBoardLine({ odds_type: 'goblin' }), false)
  assert.equal(isStandardBoardLine({ oddsType: 'demon' }), false)
})

test('NHL and NFL boards keep a row with no odds type and drop goblin and demon', () => {
  const nhl = [
    { player: 'A', oddsType: 'standard' },
    { player: 'B', oddsType: 'goblin' },
    { player: 'C', oddsType: 'demon' },
    { player: 'D' },
    { player: 'E', oddsType: 'mystery' },
  ]
  const filtered = filterStandardBoard('nhl_projections', nhl)
  assert.deepEqual(filtered.map((row) => row.player), ['A', 'D'])
  assert.equal(nhl.length, 5)

  const nfl = filterStandardBoard('nfl_projections', [
    { player: 'Std', line_type: 'standard' },
    { player: 'Gob', line_type: 'goblin' },
    { player: 'Blank' },
  ])
  assert.deepEqual(nfl.map((row) => row.player), ['Std', 'Blank'])
})

test('KBO cards and pitcher lists keep a row with no odds type', () => {
  const board = {
    total_props: 3,
    cards: [{
      name: 'Kim',
      props: [
        { stat: 'Hits', odds_type: 'standard' },
        { stat: 'Hits', odds_type: 'goblin' },
        { stat: 'Hits' },
      ],
    }, {
      name: 'Promo Only',
      props: [{ stat: 'Strikeouts', odds_type: 'demon' }],
    }],
  }
  const next = filterStandardBoard('prizepicks_props', board)
  assert.deepEqual(next.cards.map((card) => card.name), ['Kim'])
  assert.equal(next.cards[0].props.length, 2)
  assert.equal(next.total_props, 2)
  assert.equal(board.cards[0].props.length, 3)

  const pitchers = filterStandardBoard('strikeout_projections', {
    projections: [
      { name: 'A', odds_type: 'standard' },
      { name: 'B', odds_type: 'goblin' },
      { name: 'C' },
    ],
  })
  assert.deepEqual(pitchers.projections.map((row) => row.name), ['A', 'C'])
})

test('WNBA and NBA standard feeds treat a missing type as standard and drop promos', () => {
  const players = [
    { name: 'Standard', ppAllProps: [{ stat: 'Points', line: 20 }] },
    { name: 'Mixed', ppAllProps: [{ stat: 'Points', odds_type: 'standard' }, { stat: 'Rebounds', odds_type: 'demon' }] },
    { name: 'Goblin', ppAllProps: [{ stat: 'Assists', oddsType: 'goblin' }] },
  ]
  const kept = filterStandardBoard('wnba_projections_standard', players)
  assert.deepEqual(kept.map((player) => player.name), ['Standard', 'Mixed'])
  assert.equal(kept[1].ppAllProps.length, 1)
  assert.equal(players[1].ppAllProps.length, 2)

  const promo = filterStandardBoard('nba_projections_goblin', players)
  assert.deepEqual(promo.map((player) => player.name), ['Standard', 'Mixed'])
  assert.equal(promo[0].ppAllProps.length, 1)
  assert.equal(promo[1].ppAllProps.length, 1)
  assert.equal(promo[1].ppAllProps[0].odds_type, 'standard')
  const unlabeled = [{ name: 'Blank', ppAllProps: [{ stat: 'Points', line: 10 }] }]
  assert.deepEqual(filterStandardBoard('wnba_projections_demon', unlabeled), unlabeled)
  const demon = shapeForTier('wnba_projections_demon', unlabeled, 'combined')
  assert.equal(demon.preview, false)
  assert.equal(demon.data[0].name, 'Blank')
  assert.equal(demon.data[0].ppAllProps.length, 1)
})

test('the paid NHL board and the free preview keep standard lines only', () => {
  assert.equal(FILTER_STANDARD_BEFORE_FREE_PREVIEW, true)
  const rows = [
    { player: 'Goblin', prop: 'Points', line: 0.5, projection: 2, oddsType: 'goblin', rankEligible: true },
    { player: 'Standard', prop: 'Points', line: 0.5, projection: 0.9, oddsType: 'standard', rankEligible: true },
    { player: 'Missing', prop: 'Shots On Goal', line: 2.5, projection: 3, rankEligible: true },
    { player: 'Unknown', prop: 'Shots On Goal', line: 2.5, projection: 4, oddsType: 'alt', rankEligible: true },
  ]
  const paid = shapeForTier('nhl_projections', rows, 'combined')
  assert.equal(paid.preview, false)
  assert.deepEqual(paid.data.map((row) => row.player), ['Standard', 'Missing'])
  const free = shapeForTier('nhl_projections', rows, 'free')
  assert.equal(free.preview, true)
  assert.deepEqual(free.data.map((row) => row.player), ['Standard', 'Missing'])
  assert.equal(free.lockedCount, 0)
  assert.equal(rows.length, 4)
})

test('paid graded history keeps a row with no odds type and the summary matches', () => {
  const history = {
    summary: { hits: 99, misses: 99, total_graded: 99 },
    graded: [
      { player: 'Hit', result: 'HIT', type: 'OVER', stat: 'K', role: 'pitcher', edge: 2, odds_type: 'standard' },
      { player: 'Miss', result: 'MISS', type: 'UNDER', stat: 'HA', role: 'pitcher', edge: 4, odds_type: 'goblin' },
      { player: 'Demon', result: 'HIT', type: 'OVER', stat: 'K', role: 'batter', edge: 10, odds_type: 'demon' },
      { player: 'Plain', result: 'HIT', type: 'OVER', stat: 'TB', role: 'batter', edge: 6 },
    ],
    pending: [
      { player: 'Open', odds_type: 'goblin' },
      { player: 'Stay' },
    ],
  }
  const paid = shapeForTier('graded_props_history', history, 'combined')
  assert.equal(paid.preview, false)
  assert.deepEqual(paid.data.graded.map((row) => row.player), ['Hit', 'Plain'])
  assert.deepEqual(paid.data.pending.map((row) => row.player), ['Stay'])
  assert.equal(paid.data.summary.hits, 2)
  assert.equal(paid.data.summary.misses, 0)
  assert.equal(paid.data.summary.total_graded, 2)
  assert.equal(paid.data.summary.total_pending, 1)
  assert.equal(paid.data.summary.overall_hit_rate, 100)
  assert.equal(paid.data.summary.over_volume, 2)
  assert.equal(paid.data.summary.under_volume, 0)
  assert.equal(paid.data.summary.avg_edge, 4)
  assert.equal(paid.data.summary.by_stat.K.hits, 1)
  assert.equal(paid.data.summary.by_role.batter.hits, 1)
  assert.equal(history.summary.hits, 99)
  assert.equal(history.graded.length, 4)

  const unlabeled = {
    summary: { hit: 10 },
    graded: [{ id: 1 }, { id: 2 }],
    pending: [{ id: 3 }, { id: 4 }],
  }
  const kept = shapeForTier('graded_props_history', unlabeled, 'combined')
  assert.equal(kept.data.summary, unlabeled.summary)
  assert.equal(kept.data.graded.length, 2)
  assert.equal(kept.data.pending.length, 2)
})

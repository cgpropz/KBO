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
  assert.equal(isStandardBoardLine({}), false)
  assert.equal(isStandardBoardLine({}, { missingIsStandard: true }), true)
  assert.equal(isStandardBoardLine({ odds_type: 'goblin' }, { missingIsStandard: true }), false)
})

test('NHL and NFL boards drop goblin, demon, missing, and unknown lines', () => {
  const nhl = [
    { player: 'A', oddsType: 'standard' },
    { player: 'B', oddsType: 'goblin' },
    { player: 'C', oddsType: 'demon' },
    { player: 'D' },
    { player: 'E', oddsType: 'mystery' },
  ]
  const filtered = filterStandardBoard('nhl_projections', nhl)
  assert.deepEqual(filtered.map((row) => row.player), ['A'])
  assert.equal(nhl.length, 5)

  const nfl = filterStandardBoard('nfl_projections', [
    { player: 'Std', line_type: 'standard' },
    { player: 'Gob', line_type: 'goblin' },
    { player: 'Blank' },
  ])
  assert.deepEqual(nfl.map((row) => row.player), ['Std'])
})

test('KBO cards and pitcher lists keep only explicit standard props', () => {
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
  assert.equal(next.cards[0].props.length, 1)
  assert.equal(next.total_props, 1)
  assert.equal(board.cards[0].props.length, 3)

  const pitchers = filterStandardBoard('strikeout_projections', {
    projections: [
      { name: 'A', odds_type: 'standard' },
      { name: 'B', odds_type: 'goblin' },
      { name: 'C' },
    ],
  })
  assert.deepEqual(pitchers.projections.map((row) => row.name), ['A'])
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
  assert.deepEqual(promo.map((player) => player.name), ['Mixed'])
  assert.equal(promo[0].ppAllProps.length, 1)
  const unlabeled = [{ name: 'Blank', ppAllProps: [{ stat: 'Points', line: 10 }] }]
  assert.deepEqual(filterStandardBoard('wnba_projections_demon', unlabeled), [])
  const demon = shapeForTier('wnba_projections_demon', unlabeled, 'combined')
  assert.equal(demon.preview, false)
  assert.deepEqual(demon.data, [])
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
  assert.deepEqual(paid.data.map((row) => row.player), ['Standard'])
  const free = shapeForTier('nhl_projections', rows, 'free')
  assert.equal(free.preview, true)
  assert.deepEqual(free.data.map((row) => row.player), ['Standard'])
  assert.equal(free.lockedCount, 0)
  assert.equal(rows.length, 4)
})

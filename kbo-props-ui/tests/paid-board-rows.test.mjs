import assert from 'node:assert/strict'
import test from 'node:test'
import { shapeForTier } from '../api/_dataAccess.js'
import { POINTS_OVER_PROMOTE, POINTS_OVER_SHOW } from '../src/nhl/pointsGate.js'

// The Points-over gate stays on NHL. Pulled rows still leave every paid board.
// Thresholds are the published show and promote lines.

const FUTURE = '2099-01-01T00:00:00.000Z'
const BOARDS = [
  { sport: 'kbo', ds: 'prizepicks_props' },
  { sport: 'wnba', ds: 'wnba_projections_standard' },
  { sport: 'nfl', ds: 'nfl_projections' },
  { sport: 'nhl', ds: 'nhl_projections' },
]

function pointsRow(id, projection, line = 0.5) {
  return {
    id,
    player: id,
    name: id,
    prop: 'Points',
    stat: 'Points',
    line,
    projection,
    odds_type: 'standard',
    oddsType: 'standard',
    start_time: FUTURE,
    rankEligible: true,
  }
}

function payloadFor(ds, rows) {
  if (ds === 'nfl_projections' || ds === 'nhl_projections') return rows
  if (ds === 'prizepicks_props') {
    return {
      total_props: rows.length,
      cards: rows.map((line) => ({ name: line.player, start_time: FUTURE, props: [line] })),
    }
  }
  return rows.map((line) => ({ name: line.player, start_time: FUTURE, ppAllProps: [line] }))
}

function rowsFrom(ds, data) {
  if (ds === 'prizepicks_props') {
    return (data?.cards || []).flatMap((card) => card.props || [])
  }
  if (ds === 'wnba_projections_standard') {
    return (data || []).flatMap((player) => player.ppAllProps || [])
  }
  return data || []
}

test('WNBA Points rows under 0.86 are not held or dropped', () => {
  assert.equal(POINTS_OVER_SHOW, 0.69)
  assert.equal(POINTS_OVER_PROMOTE, 0.86)
  const rows = [
    pointsRow('under-show', 0.68, 0.5),
    pointsRow('under-promote', 0.8, 0.5),
    pointsRow('short-line', 0.9, 0.85),
    pointsRow('wnba-points', 22, 18.5),
  ]
  const member = shapeForTier('wnba_projections_standard', payloadFor('wnba_projections_standard', rows), 'combined')
  const kept = rowsFrom('wnba_projections_standard', member.data)
  assert.deepEqual(kept.map((row) => row.id), ['under-show', 'under-promote', 'short-line', 'wnba-points'])
  for (const row of kept) {
    assert.equal(row.rankEligible, true, row.id)
    assert.equal(row.prop, 'Points')
  }
  assert.equal(kept.find((row) => row.id === 'under-show').projection, 0.68)
  assert.equal(kept.find((row) => row.id === 'under-promote').line, 0.5)
  assert.ok(kept.find((row) => row.id === 'short-line').line < POINTS_OVER_PROMOTE)
})

test('NHL Points overs keep the show and promote lines', () => {
  const rows = [
    pointsRow('under-show', 0.68, 0.5),
    pointsRow('under-promote', 0.8, 0.5),
    pointsRow('ranked', 0.9, 0.5),
    pointsRow('under', 0.4, 0.5),
    { ...pointsRow('shots', 3.1, 2.5), prop: 'Shots On Goal', stat: 'Shots On Goal' },
  ]
  const member = shapeForTier('nhl_projections', rows, 'combined')
  const free = shapeForTier('nhl_projections', rows, 'free')
  assert.deepEqual(member.data.map((row) => row.id), ['under-promote', 'ranked', 'under', 'shots'])
  assert.equal(member.data.find((row) => row.id === 'under-promote').rankEligible, false)
  assert.equal(member.data.find((row) => row.id === 'ranked').rankEligible, true)
  assert.equal(free.data.some((row) => row.id === 'under-show' || row.id === 'under-promote'), false)
  assert.equal(free.data.some((row) => row.id === 'ranked'), true)
})

for (const board of BOARDS) {
  test(`${board.sport}: pulled and removed rows leave the paid board`, () => {
    const live = pointsRow('live', 2, 1.5)
    const pulled = [
      { ...pointsRow('removed', 2, 1.5), removed: true },
      { ...pointsRow('suspended', 2, 1.5), pp_status: 'suspended' },
      { ...pointsRow('held-status', 2, 1.5), pp_status: 'held' },
      { ...pointsRow('hold', 2, 1.5), pp_status: 'hold' },
      { ...pointsRow('onhold', 2, 1.5), pp_status: 'on-hold' },
      { ...pointsRow('pp-removed', 2, 1.5), ppStatus: 'removed' },
    ]
    const member = shapeForTier(board.ds, payloadFor(board.ds, [live, ...pulled]), 'combined')
    const kept = rowsFrom(board.ds, member.data)
    assert.deepEqual(kept.map((row) => row.id), ['live'])
  })
}

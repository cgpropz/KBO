import test from 'node:test'
import assert from 'node:assert/strict'
import { NFL_LINE_FLOORS, nflCgScore } from '../src/nfl/nflLineFloors.js'
import { DATASETS } from '../api/_dataAccess.js'

test('a line under the stat floor is scored against the floor', () => {
  assert.equal(NFL_LINE_FLOORS['Receiving Yards'], 5.5)
  assert.equal(NFL_LINE_FLOORS['Rush Yards'], 5.5)
  assert.equal(NFL_LINE_FLOORS['Receptions'], 1.5)
  assert.equal(nflCgScore(23.7, 2.5, 'Receiving Yards'), (23.7 / 5.5) * 50)
  assert.equal(nflCgScore(9.7, 1.5, 'Rush Yards'), (9.7 / 5.5) * 50)
  assert.equal(nflCgScore(1.5, 0.5, 'Receptions'), 50)
})

test('a line above the floor keeps projection / line, and a 0.5 yardage line does not score', () => {
  assert.equal(nflCgScore(70, 64.5, 'Receiving Yards'), (70 / 64.5) * 50)
  assert.equal(nflCgScore(26, 5.5, 'Receiving Yards'), (26 / 5.5) * 50)
  assert.equal(nflCgScore(3, 2.5, 'Shots On Goal'), (3 / 2.5) * 50)
  assert.equal(nflCgScore(10.7, 0.5, 'Receiving Yards'), null)
  assert.equal(nflCgScore(9.8, 0.5, 'Rush Yards'), null)
})

test('the free-preview ranker floors small lines and still drops 0.5 yardage', () => {
  const preview = DATASETS.nfl_projections.free
  const res = preview([
    { player: 'Tanner Hudson', prop: 'Receiving Yards', projection: 10.7, line: 0.5 },
    { player: 'Theo Johnson', prop: 'Receiving Yards', projection: 23.7, line: 2.5 },
    { player: 'Tee Higgins', prop: 'Receiving Yards', projection: 70, line: 64.5 },
    { player: 'Tanner Hudson', prop: 'Receptions', projection: 1.5, line: 0.5 },
  ])
  assert.deepEqual(res.data.map((row) => [row.player, row.prop, row.line]), [
    ['Theo Johnson', 'Receiving Yards', 2.5],
    ['Tee Higgins', 'Receiving Yards', 64.5],
    ['Tanner Hudson', 'Receptions', 0.5],
  ])
  assert.equal(res.data[0].projection, 23.7)
  assert.equal(res.lockedCount, 0)
})

import test from 'node:test'
import assert from 'node:assert/strict'
import { cgScore, lineMatchesStat } from '../src/cgScore.js'
import { DATASETS } from '../api/_dataAccess.js'

test('a yardage line of 0.5 is not scored', () => {
  assert.equal(cgScore(10.7, 0.5, 'Receiving Yards'), null)
  assert.equal(cgScore(9.8, 0.5, 'Rush Yards'), null)
  assert.equal(cgScore(9.7, 0.5, 'Pass+Rush Yds'), null)
  assert.equal(cgScore(4, 0.5, 'Rush+Rec Yds'), null)
  assert.equal(lineMatchesStat('Receiving Yards', 0.5), false)
  assert.equal(lineMatchesStat('Rec Yards', 0.5), false)
})

test('a real yardage line and a 0.5 counting stat still score', () => {
  assert.equal(Number(cgScore(70, 64.5, 'Receiving Yards').toFixed(1)), Number(((70 / 64.5) * 50).toFixed(1)))
  assert.equal(Number(cgScore(9.7, 1.5, 'Rush Yards').toFixed(1)), Number(((9.7 / 1.5) * 50).toFixed(1)))
  assert.equal(cgScore(1.5, 0.5, 'Receptions'), 150)
  assert.equal(cgScore(2, 1.5, 'Pass TDs'), (2 / 1.5) * 50)
  assert.equal(cgScore(12, 8.5, 'Points'), (12 / 8.5) * 50)
  assert.equal(cgScore(3, 2.5, 'Shots On Goal'), (3 / 2.5) * 50)
})

test('NFL free preview drops unmatched yardage instead of ranking it first', () => {
  const preview = DATASETS.nfl_projections.free
  const res = preview([
    { player: 'Tanner Hudson', prop: 'Receiving Yards', projection: 10.7, line: 0.5 },
    { player: 'Matthew Stafford', prop: 'Rush Yards', projection: 9.8, line: 0.5 },
    { player: 'Aaron Rodgers', prop: 'Rush Yards', projection: 9.7, line: 0.5 },
    { player: 'Tee Higgins', prop: 'Receiving Yards', projection: 70, line: 64.5 },
    { player: 'Tanner Hudson', prop: 'Receptions', projection: 1.5, line: 0.5 },
  ])
  // Receptions at 0.5 holds at 50 against the 1.5 floor: no pick, no free slot.
  assert.deepEqual(res.data.map((row) => [row.player, row.prop]), [
    ['Tee Higgins', 'Receiving Yards'],
  ])
  assert.equal(res.lockedCount, 1)
})

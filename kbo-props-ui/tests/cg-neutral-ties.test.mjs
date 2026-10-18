import test from 'node:test'
import assert from 'node:assert/strict'
import { cgSide, isNeutralCg } from '../src/cgScore.js'
import { compareNflScores, nflCgScore, nflRawScore } from '../src/nfl/nflLineFloors.js'
import { DATASETS } from '../api/_dataAccess.js'
import { nflHubRows, topHubRows } from '../src/memberHub.js'
import { selectFreeTop3 } from '../src/freeTopPicks.js'

const later = () => new Date(Date.now() + 3 * 60 * 60 * 1000).toISOString()

test('exactly 50 has no side', () => {
  assert.equal(cgSide(50), null)
  assert.equal(cgSide(50.1), 'OVER')
  assert.equal(cgSide(49.9), 'UNDER')
  assert.equal(cgSide(null), null)
  assert.equal(isNeutralCg(50), true)
  assert.equal(isNeutralCg(nflCgScore(8.5, 8.5, 'Rush Yards')), true)
  assert.equal(cgSide(nflCgScore(9.7, 1.5, 'Rush Yards')), null)
})

test('ties at 100 break on the raw uncapped score', () => {
  const hutch = [nflCgScore(35.9, 14.5, 'Receiving Yards'), nflRawScore(35.9, 14.5, 'Receiving Yards')]
  const jordan = [nflCgScore(37.1, 12.5, 'Rush Yards'), nflRawScore(37.1, 12.5, 'Rush Yards')]
  assert.equal(hutch[0], 100)
  assert.equal(jordan[0], 100)
  assert.ok(compareNflScores(jordan[0], jordan[1], hutch[0], hutch[1]) > 0)
  assert.ok(compareNflScores(hutch[0], hutch[1], jordan[0], jordan[1]) < 0)
})

test('NFL free preview: neutral rows take no slot, ties at 100 go to the higher raw score', () => {
  const res = DATASETS.nfl_projections.free([
    { player: 'Jawhar Jordan', prop: 'Rush Yards', projection: 37.1, line: 12.5, start_time: later() },
    { player: 'Xavier Hutchinson', prop: 'Receiving Yards', projection: 35.9, line: 14.5, start_time: later() },
    { player: 'On Line', prop: 'Receptions', projection: 4.5, line: 4.5, start_time: later() },
    { player: 'Held Over', prop: 'Rush Yards', projection: 9.7, line: 1.5, start_time: later() },
    { player: 'Small Edge', prop: 'Receptions', projection: 4.6, line: 4.5, start_time: later() },
  ])
  assert.deepEqual(res.data.map((row) => row.player), ['Xavier Hutchinson', 'Jawhar Jordan', 'Small Edge'])
})

test('member hub top list skips neutral NFL rows and breaks 100 ties on raw score', () => {
  const rows = nflHubRows([
    { player: 'Jawhar Jordan', prop: 'Rush Yards', projection: 37.1, line: 12.5, line_type: 'standard', start_time: later() },
    { player: 'Xavier Hutchinson', prop: 'Receiving Yards', projection: 35.9, line: 14.5, line_type: 'standard', start_time: later() },
    { player: 'Held Over', prop: 'Rush Yards', projection: 9.7, line: 1.5, line_type: 'standard', start_time: later() },
  ])
  const held = rows.find((r) => r.player === 'Held Over')
  assert.equal(held.side, null)
  assert.equal(held.neutral, true)
  assert.deepEqual(topHubRows(rows).map((r) => r.player), ['Xavier Hutchinson', 'Jawhar Jordan'])
})

test('free top 3 breaks equal shown scores on rawScore', () => {
  const rows = [
    { player: 'A', stat: 'Rush Yards', score: 100, rawScore: 100.3 },
    { player: 'B', stat: 'Receiving Yards', score: 100, rawScore: 115.8 },
    { player: 'C', stat: 'Receptions', score: 90 },
  ]
  assert.deepEqual(selectFreeTop3(rows, 'nfl').map((r) => r.player), ['B', 'A', 'C'])
})

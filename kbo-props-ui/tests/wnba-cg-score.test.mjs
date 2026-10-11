import test from 'node:test'
import assert from 'node:assert/strict'
import { shapeForTier } from '../api/_dataAccess.js'
import { wnbaCgScore } from '../src/wnba/wnbaScore.js'
import { nflCgScore } from '../src/nfl/nflLineFloors.js'
import { formatBoardUpdated } from '../src/nhl/formatBoardUpdated.js'

test('a WNBA alt row is scored on its own line', () => {
  const prop = { stat: '3-PT Made', line: 0.5, standardLine: 1.5 }
  assert.equal(wnbaCgScore(2.15, prop), (2.15 / 0.5) * 50)
  assert.notEqual(wnbaCgScore(2.15, prop), (2.15 / 1.5) * 50)
  assert.equal(wnbaCgScore(11.26, { stat: 'Points', line: 4.5, standardLine: 8.5 }), (11.26 / 4.5) * 50)
})

test('the demon free preview ranks the pick line, not the standard line', () => {
  const payload = [
    { name: 'High Standard', ppAllProps: [{ stat: 'Points', line: 20, standardLine: 8, projection: 10 }] },
    { name: 'High Own', ppAllProps: [{ stat: 'Points', line: 10, standardLine: 12, projection: 10 }] },
  ]
  const preview = shapeForTier('wnba_projections_demon', payload, 'free')
  assert.deepEqual(preview.data.map((player) => player.name), ['High Own', 'High Standard'])
  assert.equal(preview.lockedCount, 0)
})

test('the NFL per-stat line floor still applies, and a 0.5 yardage line still does not score', () => {
  assert.equal(nflCgScore(1.5, 0.5, 'Receptions'), 50)
  assert.equal(nflCgScore(23.7, 2.5, 'Receiving Yards'), (23.7 / 5.5) * 50)
  assert.equal(nflCgScore(10.7, 0.5, 'Receiving Yards'), null)
})

test('the NHL board stamp is the publish time in Eastern Time', () => {
  assert.equal(formatBoardUpdated('2026-10-09T23:13:02.940249+00:00'), 'Fri 10/9 7:13 PM ET')
  assert.equal(formatBoardUpdated('2026-10-11T14:21:33+00:00'), 'Sun 10/11 10:21 AM ET')
  assert.equal(formatBoardUpdated(''), '')
})

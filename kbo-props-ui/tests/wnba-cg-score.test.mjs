import test from 'node:test'
import assert from 'node:assert/strict'
import { shapeForTier } from '../api/_dataAccess.js'
import { WNBA_LINE_FLOORS, wnbaCgScore } from '../src/wnba/wnbaScore.js'
import { nflCgScore } from '../src/nfl/nflLineFloors.js'
import { boardStatusLine, formatBoardClock } from '../src/boardFreshness.js'

test('a WNBA alt row is scored on max(own line, stat floor), not the standard line', () => {
  const three = { stat: '3-PT Made', line: 0.5, standardLine: 2.5 }
  assert.equal(WNBA_LINE_FLOORS['3-PT Made'], 1.5)
  assert.equal(wnbaCgScore(2.15, three), (2.15 / 1.5) * 50)
  assert.notEqual(wnbaCgScore(2.15, three), (2.15 / 0.5) * 50)
  assert.notEqual(wnbaCgScore(2.15, three), (2.15 / 2.5) * 50)
  assert.equal(wnbaCgScore(11.26, { stat: 'Points', line: 8.5, standardLine: 4.5 }), (11.26 / 8.5) * 50)
  assert.equal(wnbaCgScore(11.26, { stat: 'Points', line: 4.5, standardLine: 8.5 }), (11.26 / 4.5) * 50)
})

test('a stat with no floor still divides by its own line', () => {
  assert.equal(wnbaCgScore(2, { stat: 'Double-Double', line: 0.5 }), (2 / 0.5) * 50)
})

test('the demon free preview ranks the floored pick line and keeps the posted line', () => {
  const payload = [
    { name: 'Tiny Three', ppAllProps: [{ stat: '3-PT Made', line: 0.5, standardLine: 1.5, projection: 2.15 }] },
    { name: 'Points Edge', ppAllProps: [{ stat: 'Points', line: 8.5, standardLine: 8.5, projection: 16 }] },
    { name: 'High Standard', ppAllProps: [{ stat: 'Points', line: 20, standardLine: 8, projection: 10 }] },
  ]
  const preview = shapeForTier('wnba_projections_standard', payload, 'free')
  assert.deepEqual(preview.data.map((player) => player.name), ['Points Edge', 'Tiny Three', 'High Standard'])
  assert.equal(preview.data[1].ppAllProps[0].line, 0.5)
  assert.equal(preview.lockedCount, 0)
})

test('the NBA free preview does not use the WNBA line floor', () => {
  const payload = [
    { name: 'Tiny', matched: true, projectionStatus: 'projected', gp: 40, avgMins: 30, ppAllProps: [{ stat: '3-PT Made', line: 0.5, projection: 2.15 }] },
    { name: 'Normal', matched: true, projectionStatus: 'projected', gp: 40, avgMins: 30, ppAllProps: [{ stat: 'Points', line: 8.5, projection: 12 }] },
  ]
  const preview = shapeForTier('nba_projections_standard', payload, 'free')
  assert.deepEqual(preview.data.map((player) => player.name), ['Tiny', 'Normal'])
  assert.equal(preview.data[0].ppAllProps[0].line, 0.5)
})

test('the NFL per-stat line floor still applies, and a 0.5 yardage line still does not score', () => {
  assert.equal(nflCgScore(1.5, 0.5, 'Receptions'), 50)
  assert.equal(nflCgScore(23.7, 2.5, 'Receiving Yards'), (23.7 / 15.5) * 50)
  assert.equal(nflCgScore(9.7, 1.5, 'Rush Yards'), 50)
  assert.equal(nflCgScore(10.7, 0.5, 'Receiving Yards'), null)
})

test('the NHL board stamp is the publish time in Eastern Time', () => {
  assert.equal(formatBoardClock('2026-10-09T23:13:02.940249+00:00'), '7:13 PM ET')
  assert.equal(formatBoardClock('2026-10-11T14:21:33+00:00'), '10:21 AM ET')
  assert.equal(formatBoardClock(''), '')
  const now = new Date('2026-10-11T15:00:00Z')
  assert.equal(
    boardStatusLine({ updatedAt: '2026-10-11T14:21:33+00:00', sport: 'nhl', now }),
    'Board updated 10:21 AM ET',
  )
})

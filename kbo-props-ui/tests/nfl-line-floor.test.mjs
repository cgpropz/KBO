import test from 'node:test'
import assert from 'node:assert/strict'
import { NFL_LINE_FLOORS, nflCgScore } from '../src/nfl/nflLineFloors.js'
import { DATASETS, gameAlreadyStarted } from '../api/_dataAccess.js'

test('receiving and rushing yards use the Middle cap, and other floors stay put', () => {
  assert.equal(NFL_LINE_FLOORS['Receiving Yards'], 15.5)
  assert.equal(NFL_LINE_FLOORS['Rush Yards'], 18.5)
  assert.equal(NFL_LINE_FLOORS['Receptions'], 1.5)
  assert.equal(NFL_LINE_FLOORS['Pass Yards'], 186.5)
  assert.equal(NFL_LINE_FLOORS['Rush+Rec Yds'], 30.5)
  assert.equal(nflCgScore(23.7, 2.5, 'Receiving Yards'), (23.7 / 15.5) * 50)
  assert.equal(nflCgScore(18.9, 7.5, 'Receiving Yards'), (18.9 / 15.5) * 50)
  // An over the floor would score below 50 holds at 50. It never reads as an under.
  assert.equal(nflCgScore(9.7, 1.5, 'Rush Yards'), 50)
  assert.equal(nflCgScore(17.6, 8.5, 'Rush Yards'), 50)
  assert.equal(nflCgScore(1.8, 1.5, 'Receiving Yards'), 50)
  assert.equal(nflCgScore(1.5, 0.5, 'Receptions'), 50)
  // Unders stay on the floored ratio, and an exact tie is 50.
  assert.equal(nflCgScore(5, 8.5, 'Rush Yards'), (5 / 18.5) * 50)
  assert.equal(nflCgScore(8.5, 8.5, 'Rush Yards'), 50)
})

test('NFL CG Score is bounded 0-100', () => {
  assert.equal(nflCgScore(35.9, 14.5, 'Receiving Yards'), 100)
  assert.equal(nflCgScore(37.1, 12.5, 'Rush Yards'), 100)
  assert.equal(nflCgScore(300, 64.5, 'Receiving Yards'), 100)
  assert.equal(nflCgScore(-5, 64.5, 'Receiving Yards'), 0)
  assert.equal(nflCgScore(30, 15.5, 'Receiving Yards'), (30 / 15.5) * 50)
})

test('a line above the floor keeps projection / line, and a 0.5 yardage line does not score', () => {
  assert.equal(nflCgScore(70, 64.5, 'Receiving Yards'), (70 / 64.5) * 50)
  assert.equal(nflCgScore(28.4, 17.5, 'Receiving Yards'), (28.4 / 17.5) * 50)
  assert.equal(nflCgScore(27.9, 15.5, 'Receiving Yards'), (27.9 / 15.5) * 50)
  assert.equal(nflCgScore(54.7, 41.5, 'Rush Yards'), (54.7 / 41.5) * 50)
  assert.equal(nflCgScore(25, 18.5, 'Rush Yards'), (25 / 18.5) * 50)
  assert.equal(nflCgScore(26, 5.5, 'Receiving Yards'), (26 / 15.5) * 50)
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

test('the free preview skips a game whose start_time has already passed', () => {
  const now = new Date('2026-10-11T13:40:00Z')
  assert.equal(gameAlreadyStarted({ start_time: '2026-10-11T09:30:00.000-04:00' }, now), true)
  assert.equal(gameAlreadyStarted({ start_time: '2026-10-11T13:00:00.000-04:00' }, now), false)
  assert.equal(gameAlreadyStarted({ start_time: '2026-10-11T13:40:00Z' }, now), true)
  assert.equal(gameAlreadyStarted({ start_time: '' }, now), false)

  const started = new Date(Date.now() - 60 * 1000).toISOString()
  const upcoming = new Date(Date.now() + 60 * 60 * 1000).toISOString()
  const preview = DATASETS.nfl_projections.free
  const res = preview([
    { player: 'Zach Ertz', prop: 'Receiving Yards', projection: 26, line: 5.5, start_time: started },
    { player: 'Theo Johnson', prop: 'Receiving Yards', projection: 23.7, line: 2.5, start_time: upcoming },
    { player: 'Calvin Ridley', prop: 'Receiving Yards', projection: 26.8, line: 8.5, start_time: upcoming },
    { player: 'Raheim Sanders', prop: 'Rush Yards', projection: 15.9, line: 5.5, start_time: upcoming },
    { player: 'Sterling Shepard', prop: 'Receiving Yards', projection: 15.1, line: 5.5, start_time: upcoming },
  ])
  assert.deepEqual(res.data.map((row) => [row.player, row.prop]), [
    ['Calvin Ridley', 'Receiving Yards'],
    ['Theo Johnson', 'Receiving Yards'],
    // Both short overs hold at 50; the earlier row wins the tie.
    ['Raheim Sanders', 'Rush Yards'],
  ])
  assert.equal(res.data[2].line, 5.5)
  assert.equal(res.lockedCount, 1)
})

test('the free preview keeps one prop per player, the highest score', () => {
  const preview = DATASETS.nfl_projections.free
  const res = preview([
    { player: 'Konata Mumpfield', prop: 'Receiving Yards', projection: 40, line: 20 },
    { player: 'Konata Mumpfield', prop: 'Receptions', projection: 6, line: 4 },
    { player: 'Brock Purdy', prop: 'Pass TDs', projection: 2, line: 1.5 },
    { player: 'Rashod Bateman', prop: 'Rec Targets', projection: 4, line: 3.5 },
    { player: 'Tyler Higbee', prop: 'Rush Attempts', projection: 10, line: 10 },
    { player: 'Konata Mumpfield', prop: 'Receiving Yards', projection: 10.7, line: 0.5 },
  ])
  // Yards at 20 score 100 and beat his receptions at 75. The 0.5 yardage line
  // does not score, so it is not his best prop and is not eligible.
  assert.deepEqual(res.data.map((row) => [row.player, row.prop, row.line]), [
    ['Konata Mumpfield', 'Receiving Yards', 20],
    ['Brock Purdy', 'Pass TDs', 1.5],
    ['Rashod Bateman', 'Rec Targets', 3.5],
  ])
  assert.equal(res.lockedCount, 2)
})

test('a tie keeps the earlier prop for that player', () => {
  const preview = DATASETS.nfl_projections.free
  const res = preview([
    { player: 'Same Score', prop: 'Receptions', projection: 3, line: 3, id: 'first' },
    { player: 'Same Score', prop: 'Rec Targets', projection: 4, line: 4, id: 'second' },
    { player: 'Other', prop: 'Pass TDs', projection: 1, line: 2 },
  ])
  assert.equal(res.data[0].id, 'first')
  assert.equal(res.data.filter((row) => row.player === 'Same Score').length, 1)
})

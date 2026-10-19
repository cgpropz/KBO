import test from 'node:test'
import assert from 'node:assert/strict'
import { kboHubRows, rowIsHeldOrOut, topHubRows } from '../src/memberHub.js'
import { publicBoardRows } from '../src/publicBoard.js'

const start = new Date(Date.now() + 6 * 3600e3).toISOString()
const card = (name, props) => ({ name, team: 'LG', opponent: 'KT', start_time: start, games: [], props })
const prop = (stat, line, projection, cg) => ({ stat, line, projection, cg_projection: cg, odds_type: 'standard', recommendation: projection > line ? 'OVER' : projection < line ? 'UNDER' : 'EVEN' })

test('KBO hub ranks by the displayed capped rating, not cg_projection', () => {
  const rows = kboHubRows({ cards: [
    card('StrongUnder', [prop('Hits+Runs+RBIs', 2.5, 1.0, 95)]),
    card('Over', [prop('Total Bases', 1.5, 2.4, 40)]),
  ] })
  const by = Object.fromEntries(rows.map((r) => [r.player, r]))
  assert.equal(by.StrongUnder.score, 20)
  assert.equal(by.Over.score, 80)
  assert.deepEqual(topHubRows(rows, 2).map((r) => r.player), ['Over', 'StrongUnder'])
})

test('KBO hub: ties at 100 break on the raw ratio; exactly 50 is neutral and left out', () => {
  const rows = kboHubRows({ cards: [
    card('Park', [prop('Total Bases', 0.5, 1.316, 60)]),
    card('Lee', [prop('Total Bases', 0.5, 1.1, 99)]),
    card('Even', [prop('Total Bases', 1.5, 1.5, 99)]),
  ] })
  const by = Object.fromEntries(rows.map((r) => [r.player, r]))
  assert.equal(by.Park.score, 100)
  assert.equal(by.Lee.score, 100)
  assert.ok(by.Park.rawScore > by.Lee.rawScore)
  assert.equal(by.Even.neutral, true)
  assert.equal(by.Even.side, null)
  assert.deepEqual(topHubRows(rows, 3).map((r) => r.player), ['Park', 'Lee'])
})

test('KBO hub: a null-projection prop (NO LINE) has no score or side and stays off the top lists', () => {
  const noLine = { stat: 'Hits Allowed', line: 4.5, projection: null, avg: 3.8, cg_projection: null, odds_type: 'standard', recommendation: 'NO LINE' }
  const rows = kboHubRows({ cards: [
    card('Moon', [noLine]),
    card('Over', [prop('Total Bases', 1.5, 2.4, 40)]),
  ] })
  const by = Object.fromEntries(rows.map((r) => [r.player, r]))
  assert.ok(Number.isNaN(by.Moon.score))
  assert.ok(Number.isNaN(by.Moon.rawScore))
  assert.equal(by.Moon.side, null)
  assert.notEqual(by.Moon.score, 0)
  assert.deepEqual(topHubRows(rows, 10).map((r) => r.player), ['Over'])
  assert.deepEqual(publicBoardRows(rows).map((r) => r.player), ['Over'])
})

test('hub rowIsHeldOrOut: removed === true is held even with no status', () => {
  assert.equal(rowIsHeldOrOut({ player: 'A', stat: 'Hits', line: 0.5, removed: true }), true)
  assert.equal(rowIsHeldOrOut({ player: 'A', stat: 'Hits', line: 0.5, removed: false }), false)
})

test('KBO hub: a removed row is excluded from the hub top list and the public board', () => {
  const removedProp = { ...prop('Total Bases', 0.5, 1.316, 60), removed: true }
  const rows = kboHubRows({ cards: [
    card('Gone', [removedProp]),
    card('Over', [prop('Total Bases', 1.5, 2.4, 40)]),
  ] })
  const gone = rows.find((r) => r.player === 'Gone')
  assert.equal(gone.removed, true)
  assert.equal(rowIsHeldOrOut(gone), true)
  assert.deepEqual(topHubRows(rows, 10).map((r) => r.player), ['Over'])
  assert.deepEqual(publicBoardRows(rows).map((r) => r.player), ['Over'])
})

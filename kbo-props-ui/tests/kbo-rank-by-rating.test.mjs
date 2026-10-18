import test from 'node:test'
import assert from 'node:assert/strict'
import { kboHubRows, topHubRows } from '../src/memberHub.js'

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

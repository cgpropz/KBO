import assert from 'node:assert/strict'
import test from 'node:test'
import { naturalSide, rawSlipCg, shownCg, slipCg } from '../src/slipBoardModel.js'

test('NBA slip score is bounded 0-100; the raw score still breaks ties', () => {
  const over = { sport: 'nba', projection: 5.68, line: 2.5, prop: 'Assists' }
  assert.equal(slipCg(over), 100)
  assert.equal(shownCg(over), 100)
  assert.equal(naturalSide(over), 'MORE')
  assert.ok(rawSlipCg(over) > 100)
  const negative = { sport: 'nba', projection: -1, line: 2.5, prop: 'Assists' }
  assert.equal(slipCg(negative), 0)
  assert.equal(naturalSide(negative), 'LESS')
})

test('WNBA and NHL slip scores stay uncapped; KBO is bounded like NBA', () => {
  const row = { projection: 5.68, line: 2.5, prop: 'Assists' }
  assert.equal(slipCg({ ...row, sport: 'wnba' }), (5.68 / 2.5) * 50)
  assert.equal(slipCg({ ...row, sport: 'nhl' }), (5.68 / 2.5) * 50)
  // KBO is now bounded 0-100 too (tests/kbo-slip-cap-rank.test.mjs).
  assert.equal(slipCg({ ...row, sport: 'kbo' }), 100)
})

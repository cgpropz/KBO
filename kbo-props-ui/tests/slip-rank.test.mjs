import assert from 'node:assert/strict'
import { test } from 'node:test'
import { PRIZEPICKS_LINEUPS } from '../src/prizepicksBreakeven.js'
import { averageCg, legCg, payoutFor, playersRepeat } from '../src/slipRank.js'

test('ranking uses CG Score and mirrors an under around 50', () => {
  const over = legCg({ projection: 4.2, line: 3.5, prop: 'Shots On Goal' }, 'OVER')
  assert.equal(over, (4.2 / 3.5) * 50)
  const under = legCg({ projection: 1.2, line: 1.5, prop: 'Points' }, 'UNDER')
  assert.equal(under, 100 - ((1.2 / 1.5) * 50))
  assert.equal(legCg({ projection: 12, line: 0.5, prop: 'Receiving Yards' }, 'OVER'), null)
  const avg = averageCg([
    { projection: 4.2, line: 3.5, prop: 'Shots On Goal', side: 'OVER' },
    { projection: 1.2, line: 1.5, prop: 'Points', side: 'UNDER' },
  ])
  assert.equal(avg, (over + under) / 2)
})

test('a player cannot appear twice, by id or by name', () => {
  assert.equal(playersRepeat([
    { name: 'RJ Harvey', playerId: '1', prop: 'Rush Yards' },
    { name: 'RJ Harvey', playerId: '1', prop: 'Rush Attempts' },
  ]), true)
  assert.equal(playersRepeat([
    { name: 'Troy Franklin', prop: 'Receiving Yards' },
    { name: 'Troy Franklin', prop: 'Receptions' },
  ]), true)
  assert.equal(playersRepeat([
    { name: 'Troy Franklin', prop: 'Receiving Yards' },
    { name: 'Tory Horton', prop: 'Receiving Yards' },
  ]), false)
})

test('Power and Flex payouts come from the published table', () => {
  for (const row of PRIZEPICKS_LINEUPS) {
    const payout = payoutFor(row.mode, row.picks)
    assert.equal(payout.payout, row.payout)
    assert.equal(payout.breakeven, row.rate)
  }
  assert.equal(payoutFor('power', 3).payout, '6x')
  assert.equal(payoutFor('flex', 2).payout, '2x / 0.5x')
  assert.equal(payoutFor('power', 3, { altered: true }).altered, true)
  assert.equal(payoutFor('power', 1), null)
})

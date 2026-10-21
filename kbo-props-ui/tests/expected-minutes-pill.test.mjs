import assert from 'node:assert/strict'
import test from 'node:test'
import { expectedMinutesPill } from '../src/nba/expectedMinutes.js'
import { buildPropRows } from '../src/nba/nbaPropLines.js'
import { nbaHubRows, wnbaHubRows } from '../src/memberHub.js'

test('minutes pill rounds first, then picks the color', () => {
  assert.deepEqual(expectedMinutesPill(19.6), { minutes: 20, label: '20 MIN', color: 'yellow' })
  assert.deepEqual(expectedMinutesPill(19.4), { minutes: 19, label: '19 MIN', color: 'red' })
  assert.deepEqual(expectedMinutesPill(19.5), { minutes: 20, label: '20 MIN', color: 'yellow' })
  assert.deepEqual(expectedMinutesPill(29.4), { minutes: 29, label: '29 MIN', color: 'yellow' })
  assert.deepEqual(expectedMinutesPill(29.5), { minutes: 30, label: '30 MIN', color: 'green' })
  assert.deepEqual(expectedMinutesPill(20), { minutes: 20, label: '20 MIN', color: 'yellow' })
  assert.deepEqual(expectedMinutesPill(30), { minutes: 30, label: '30 MIN', color: 'green' })
  assert.deepEqual(expectedMinutesPill(32.2), { minutes: 32, label: '32 MIN', color: 'green' })
})

test('missing minutes hide the pill', () => {
  for (const value of [null, undefined, '', '   ', NaN, 'nope', Infinity]) {
    assert.equal(expectedMinutesPill(value), null, String(value))
  }
})

test('NBA cards keep the published avgMins and do not change the score', () => {
  const player = {
    name: 'AJ Green',
    team: 'MIL',
    avgMins: 29.5,
    ppAllProps: [{ stat: 'Points', line: 7.5, projection: 12, rating: 88, odds_type: 'standard' }],
  }
  const hub = nbaHubRows([player])[0]
  assert.equal(hub.avgMins, 29.5)
  assert.equal(hub.score, 88)
  const wnba = wnbaHubRows([{ ...player, ppAllProps: [{ stat: 'Points', line: 7.5, projection: 12, odds_type: 'standard' }] }])[0]
  assert.equal('avgMins' in wnba, false)

  const shown = buildPropRows([player], [])[0]
  const hidden = buildPropRows([{ ...player, avgMins: null }], [])[0]
  assert.equal(shown.avgMins, 29.5)
  assert.equal(hidden.avgMins, null)
  assert.equal(shown.score, hidden.score)
  assert.equal(shown.side, hidden.side)
})

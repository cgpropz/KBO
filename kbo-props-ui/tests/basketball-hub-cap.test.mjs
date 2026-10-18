import test from 'node:test'
import assert from 'node:assert/strict'
import { nbaHubRows, topHubRows, wnbaHubRows } from '../src/memberHub.js'

const start = new Date(Date.now() + 6 * 3600e3).toISOString()
const player = (name, prop) => ({ name, team: 'AAA', recentGames: [], ppAllProps: [{ odds_type: 'standard', opponent: 'BBB', start_time: start, ...prop }] })

test('WNBA hub score is capped at 100 and keeps the raw score', () => {
  const [row] = wnbaHubRows([player('Big', { stat: 'Points', line: 5.5, projection: 11.24 })], [])
  assert.equal(row.score, 100)
  assert.ok(row.rawScore > 100)
  assert.equal(row.side, 'OVER')
})

test('NBA hub score is bounded 0-100; ties at 100 break on the raw score', () => {
  const rows = nbaHubRows([
    player('Lower', { stat: 'Points', line: 10.5, projection: 20, rating: 101 }),
    player('Higher', { stat: 'Points', line: 10.5, projection: 22, rating: 130 }),
    player('Neg', { stat: 'Points', line: 10.5, projection: 2, rating: -12 }),
    player('Even', { stat: 'Points', line: 10.5, projection: 10.5, rating: 50 }),
  ], [])
  const by = Object.fromEntries(rows.map((r) => [r.player, r]))
  assert.equal(by.Lower.score, 100)
  assert.equal(by.Higher.score, 100)
  assert.equal(by.Neg.score, 0)
  assert.equal(by.Neg.rawScore, -12)
  assert.equal(by.Even.neutral, true)
  assert.equal(by.Even.side, null)
  const top = topHubRows(rows, 5).map((r) => r.player)
  assert.deepEqual(top.slice(0, 2), ['Higher', 'Lower'])
  assert.ok(!top.includes('Even'))
})

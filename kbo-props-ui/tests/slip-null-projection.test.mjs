import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'
import { compareSlipRows } from '../src/slipBoardModel.js'
import { isStandardLine, oddsTypeOf } from '../src/slipLines.js'
import { nbaHubRows } from '../src/memberHub.js'

// Synthetic fixtures only. A pending NBA row (no projection yet) must not
// show up in the slip builder as PROJ 0 / CG 0 / LESS, and the hub must not
// give it a side.
function loadBasketRows() {
  const source = readFileSync(new URL('../src/slipSports.js', import.meta.url), 'utf8')
  const start = source.indexOf('function lineTypePresent')
  const end = source.indexOf('async function loadBasketProps')
  const helpers = source.slice(source.indexOf('function byCg'), source.indexOf('async function loadKboProps'))
  const num = (value) => {
    const n = Number(value)
    return Number.isFinite(n) ? n : null
  }
  return new Function('isStandardLine', 'oddsTypeOf', 'num', 'compareSlipRows', 'keepSlipRow', 'BASKET_SHORT', `${helpers}\n${source.slice(start, end)}\nreturn basketRows`)(
    isStandardLine,
    oddsTypeOf,
    num,
    compareSlipRows,
    () => true,
    { Points: 'PTS', Rebounds: 'REB', Assists: 'AST', Turnovers: 'TOV' },
  )
}

test('slip builder skips basketball props with a null, empty or non-numeric projection', () => {
  const basketRows = loadBasketRows()
  const players = [{
    name: 'Test Rookie',
    team: 'AAA',
    projectionStatus: 'pending',
    ppAllProps: [
      { stat: 'Points', line: 5.5, projection: null, opponent: 'BBB' },
      { stat: 'Rebounds', line: 3.5, projection: '', opponent: 'BBB' },
      { stat: 'Turnovers', line: 1.5, opponent: 'BBB' },
      { stat: 'Assists', line: 2.5, projection: 'n/a', opponent: 'BBB' },
    ],
  }, {
    name: 'Test Veteran',
    team: 'CCC',
    ppAllProps: [
      { stat: 'Points', line: 10.5, projection: 12, opponent: 'DDD' },
      { stat: 'Assists', line: 0.5, projection: 0, opponent: 'DDD' },
      { stat: 'Rebounds', line: 4.5, projection: '5.5', opponent: 'DDD' },
    ],
  }]
  const rows = basketRows(players, { source: 'projections_standard.json', sport: 'nba' })
  assert.deepEqual(rows.map((row) => `${row.name}|${row.prop}|${row.projection}`).sort(), [
    'Test Veteran|Assists|0',
    'Test Veteran|Points|12',
    'Test Veteran|Rebounds|5.5',
  ])
  assert.equal(rows.some((row) => row.name === 'Test Rookie'), false)
})

test('hub gives a pending NBA row no side', () => {
  const player = (projection) => ({
    name: 'Test Rookie',
    team: 'AAA',
    matched: true,
    projectionStatus: projection == null ? 'pending' : 'projected',
    gp: 1,
    avgMins: 20,
    ppAllProps: [{ stat: 'Points', line: 5.5, projection, rating: null, opponent: 'BBB', odds_type: 'standard' }],
  })
  const [pending] = nbaHubRows([player(null)])
  assert.equal(pending.side, null)
  const [blank] = nbaHubRows([player('')])
  assert.equal(blank.side, null)
  const [zero] = nbaHubRows([player(0)])
  assert.equal(zero.side, 'UNDER')
})

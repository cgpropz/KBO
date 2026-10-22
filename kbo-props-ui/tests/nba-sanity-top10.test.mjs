import assert from 'node:assert/strict'
import test from 'node:test'
import { shapeForTier } from '../api/_dataAccess.js'
import { buildPropRows } from '../src/nba/nbaPropLines.js'
import {
  hitRateBlockReason,
  nbaHubRows,
  topHitRateRows,
  topHubRows,
  wnbaHubRows,
} from '../src/memberHub.js'
import { nbaPublicRows, publicFreeTopRows } from '../src/publicBoard.js'
import { filterStandardBoard } from '../src/standardBoard.js'

// Synthetic rows only. The projection step flags a ratio outside 0.5-2.0.
// 0.5 and 2.0 stay inside, matching that check.
const NOW = new Date('2026-10-21T01:00:00Z')
const START = '2099-10-21T23:00:00Z'
const OVERS = Array.from({ length: 12 }, () => 30)
const UNDERS = Array.from({ length: 12 }, () => 4)

function existingCheckFlags(ratio) {
  return Number.isFinite(ratio) && (ratio < 0.5 || ratio > 2)
}

function safePlayer(name, props) {
  return {
    name,
    team: 'SAS',
    matched: true,
    projectionStatus: 'projected',
    gp: 60,
    avgMins: 28,
    espnInjuryChecked: true,
    espnInjuryStatus: null,
    ppAllProps: props.map((prop) => ({
      stat: 'Points',
      odds_type: 'standard',
      start_time: START,
      rating: 70,
      ...prop,
      ratio: prop.projection / prop.line,
      sanity_flag: existingCheckFlags(prop.projection / prop.line),
      l10Values: prop.l10Values,
    })),
  }
}

test('0.5 and 2.0 stay inside the existing check', () => {
  assert.equal(existingCheckFlags(0.5), false)
  assert.equal(existingCheckFlags(2), false)
  assert.equal(existingCheckFlags(1), false)
  assert.equal(existingCheckFlags(0.49), true)
  assert.equal(existingCheckFlags(2.01), true)
  assert.equal(existingCheckFlags(Number.NaN), false)
})

test('NBA Top 10 hit rate drops a flagged row and keeps an unflagged row', () => {
  const players = [
    safePlayer('Inside', [{ line: 10, projection: 12, l10Values: OVERS }]),
    safePlayer('Low Bound', [{ line: 20, projection: 10, l10Values: UNDERS }]),
    safePlayer('High Bound', [{ line: 10, projection: 20, l10Values: OVERS }]),
    safePlayer('Below', [{ line: 20, projection: 9.8, l10Values: UNDERS, rating: 99 }]),
    safePlayer('Above', [{ line: 10, projection: 20.1, l10Values: OVERS }]),
  ]
  const rows = nbaHubRows(players)
  const byName = Object.fromEntries(rows.map((row) => [row.player, row]))

  assert.equal(byName['Low Bound'].ratio, 0.5)
  assert.equal(byName['Low Bound'].sanity_flag, false)
  assert.equal(byName['High Bound'].ratio, 2)
  assert.equal(byName['High Bound'].sanity_flag, false)
  assert.equal(byName.Inside.sanity_flag, false)
  assert.equal(byName.Below.sanity_flag, true)
  assert.equal(byName.Above.sanity_flag, true)
  assert.equal(hitRateBlockReason(byName['Low Bound'], NOW), null)
  assert.equal(hitRateBlockReason(byName['High Bound'], NOW), null)
  assert.equal(hitRateBlockReason(byName.Inside, NOW), null)
  assert.equal(hitRateBlockReason(byName.Below, NOW), 'sanity')
  assert.equal(hitRateBlockReason(byName.Above, NOW), 'sanity')

  assert.deepEqual(
    topHitRateRows(rows, 10, NOW).map((row) => row.player).sort(),
    ['High Bound', 'Inside', 'Low Bound'],
  )

  // CG Score order still includes the flagged rows. Below leads on its rating.
  const ranked = topHubRows(rows, 10).map((row) => row.player)
  assert.equal(ranked[0], 'Below')
  assert.equal(ranked.includes('Above'), true)
  assert.equal(ranked.includes('Inside'), true)

  // Main board keeps every prop.
  const board = buildPropRows(players, [])
  assert.deepEqual(board.map((row) => row.player).sort(), ['Above', 'Below', 'High Bound', 'Inside', 'Low Bound'])

  // Free top 3 still ranks by score. Above is flagged and still leads.
  const free = publicFreeTopRows(nbaPublicRows(players), 3)
  assert.equal(free[0].player, 'Above')
  assert.equal(free.some((row) => row.player === 'High Bound'), true)

  const preview = shapeForTier('nba_projections_standard', players, 'free')
  assert.equal(preview.data.some((player) => player.name === 'Above'), true)
  const published = filterStandardBoard('nba_projections_standard', players)
  const flags = published.flatMap((player) => player.ppAllProps).filter((prop) => prop.sanity_flag === true)
  assert.equal(flags.length, 2)
  assert.equal(published.length, players.length)
})

test('a row with no stored flag stays on the Top 10 hit rate list', () => {
  const legacy = nbaHubRows([{
    name: 'Legacy',
    team: 'SAS',
    matched: true,
    projectionStatus: 'projected',
    gp: 60,
    avgMins: 28,
    espnInjuryChecked: true,
    espnInjuryStatus: null,
    ppAllProps: [{
      stat: 'Points',
      line: 10,
      projection: 12,
      rating: 70,
      odds_type: 'standard',
      start_time: START,
      l10Values: OVERS,
    }],
  }])
  assert.equal(legacy[0].sanity_flag, false)
  assert.equal(legacy[0].ratio, null)
  assert.equal(hitRateBlockReason(legacy[0], NOW), null)
  assert.deepEqual(topHitRateRows(legacy, 10, NOW).map((row) => row.player), ['Legacy'])
})

test('one flagged prop leaves the hit-rate list and the other prop stays', () => {
  const player = safePlayer('Split Wing', [
    { stat: 'Points', line: 10, projection: 20.1, l10Values: OVERS, rating: 95 },
    { stat: 'Rebounds', line: 10, projection: 12, l10Values: OVERS, rating: 60 },
  ])
  const rows = nbaHubRows([player])
  assert.equal(rows.length, 2)
  const points = rows.find((row) => row.stat === 'Points')
  const rebounds = rows.find((row) => row.stat === 'Rebounds')
  assert.equal(points.sanity_flag, true)
  assert.equal(rebounds.sanity_flag, false)
  assert.deepEqual(topHitRateRows(rows, 10, NOW).map((row) => row.stat), ['Rebounds'])
  assert.equal(topHubRows(rows, 5)[0].stat, 'Points')
  assert.equal(buildPropRows([player], []).length, 2)
})

test('a WNBA row is not dropped from the hit-rate list for this flag', () => {
  const rows = wnbaHubRows([{
    name: 'Flagged Wing',
    team: 'ATL',
    ppAllProps: [{
      stat: 'Points',
      line: 8,
      projection: 12,
      odds_type: 'standard',
      start_time: START,
      l10Values: OVERS,
      sanity_flag: true,
      ratio: 0.2,
    }],
  }])
  assert.notEqual(rows[0].sanity_flag, true)
  assert.equal(hitRateBlockReason(rows[0], NOW), null)
  assert.deepEqual(topHitRateRows(rows, 10, NOW).map((row) => row.player), ['Flagged Wing'])
})

import assert from 'node:assert/strict'
import test from 'node:test'
import { shapeForTier } from '../api/_dataAccess.js'
import { rowIsHeldOrOut } from '../src/memberHub.js'
import { PULLED_PP_STATUSES, dropPulledRows, isPulledPpStatus, prizepicksPulled } from '../src/nhl/pointsGate.js'
import { keepSlipRow } from '../src/slipAvailability.js'

// A pulled pp_status is enough on its own. `out` (NFL OUT, #251),
// `replaced`, and `superseded` leave the boards and the free top-3 pool even
// when the removed flag is missing.

const FUTURE = '2099-01-01T00:00:00.000Z'
const NOW = new Date('2026-10-16T22:00:00Z')
const BOARDS = [
  { sport: 'kbo', ds: 'prizepicks_props' },
  { sport: 'wnba', ds: 'wnba_projections_standard' },
  { sport: 'nfl', ds: 'nfl_projections' },
  { sport: 'nhl', ds: 'nhl_projections' },
]
const NEW_STATUSES = ['out', 'OUT', 'Out', 'replaced', 'Replaced', 'SUPERSEDED', 'superseded', ' out ']

function row(id, projection, line) {
  return {
    id,
    player: id,
    name: id,
    prop: 'Shots On Goal',
    stat: 'Shots On Goal',
    line,
    projection,
    odds_type: 'standard',
    oddsType: 'standard',
    start_time: FUTURE,
    rankEligible: true,
  }
}

function payloadFor(ds, rows) {
  if (ds === 'nfl_projections' || ds === 'nhl_projections') return rows
  if (ds === 'prizepicks_props') {
    return {
      total_props: rows.length,
      cards: rows.map((line) => ({ name: line.player, start_time: FUTURE, props: [line] })),
    }
  }
  return rows.map((line) => ({ name: line.player, start_time: FUTURE, ppAllProps: [line] }))
}

function rowsFrom(ds, data) {
  if (ds === 'prizepicks_props') return (data?.cards || []).flatMap((card) => card.props || [])
  if (ds === 'wnba_projections_standard') return (data || []).flatMap((player) => player.ppAllProps || [])
  return Array.isArray(data) ? data : []
}

function pulledRows() {
  // Very strong projections, so each would lead the free top 3 if it stayed.
  return NEW_STATUSES.map((status, i) => ({ ...row(`pulled-${i}`, 9 + i, 2.5), pp_status: status }))
    .concat([
      { ...row('camel-out', 20, 2.5), ppStatus: 'out' },
      { ...row('camel-replaced', 20, 2.5), ppStatus: 'Replaced' },
    ])
}

test('server pulled list covers out, replaced, superseded with the same normalization', () => {
  for (const status of ['out', 'replaced', 'superseded']) assert.ok(PULLED_PP_STATUSES.has(status), status)
  for (const status of NEW_STATUSES) assert.equal(isPulledPpStatus(status), true, status)
  for (const status of ['removed', 'Suspended', 'On Hold', 'on-hold', 'held', 'hold']) {
    assert.equal(isPulledPpStatus(status), true, status)
  }
  for (const status of ['pre_game', 'open', 'active', '', null, undefined, 'outs', 'replacement']) {
    assert.equal(isPulledPpStatus(status), false, String(status))
  }
  for (const pulled of pulledRows()) {
    assert.equal(pulled.removed, undefined)
    assert.equal(prizepicksPulled(pulled), true, pulled.id)
  }
  assert.deepEqual(dropPulledRows([row('live', 3, 2.5), ...pulledRows()]).map((r) => r.id), ['live'])
})

for (const board of BOARDS) {
  test(`${board.sport}: out / replaced / superseded with no removed flag leave the paid board`, () => {
    const live = row('live', 3, 2.5)
    const member = shapeForTier(board.ds, payloadFor(board.ds, [live, ...pulledRows()]), 'combined')
    assert.deepEqual(rowsFrom(board.ds, member.data).map((r) => r.id), ['live'])
  })

  test(`${board.sport}: out / replaced / superseded with no removed flag stay out of the free top 3`, () => {
    const live = row('live', 3, 2.5)
    const free = shapeForTier(board.ds, payloadFor(board.ds, [live, ...pulledRows()]), 'free')
    const ids = rowsFrom(board.ds, free.data).map((r) => r.id)
    for (const id of ids) assert.equal(id.startsWith('pulled') || id.startsWith('camel'), false, `${board.sport} ${id}`)
    // The pulled rows do not count toward the locked remainder either.
    assert.ok(free.lockedCount <= 1, `${board.sport} lockedCount ${free.lockedCount}`)
  })
}

test('#251 NFL OUT rows drop the same with or without removed=true', () => {
  const live = { ...row('live', 70, 55.5), prop: 'Rush Yards', stat: 'Rush Yards' }
  const stamped = { ...row('out-stamped', 90, 55.5), prop: 'Rush Yards', stat: 'Rush Yards', removed: true, pp_status: 'out' }
  const statusOnly = { ...stamped, id: 'out-status-only', player: 'out-status-only', removed: undefined }
  delete statusOnly.removed
  for (const tier of ['combined', 'free']) {
    const shaped = shapeForTier('nfl_projections', [live, stamped, statusOnly], tier)
    const ids = rowsFrom('nfl_projections', shaped.data).map((r) => r.id)
    assert.equal(ids.includes('out-stamped'), false, tier)
    assert.equal(ids.includes('out-status-only'), false, tier)
  }
})

test('client mirror: hub and slip builder treat the same statuses as pulled', () => {
  for (const status of NEW_STATUSES) {
    const pulled = { ...row('p', 9, 2.5), pp_status: status }
    assert.equal(rowIsHeldOrOut(pulled), true, status)
    assert.equal(keepSlipRow(pulled, { now: NOW }), false, status)
    assert.equal(rowIsHeldOrOut({ ...row('p', 9, 2.5), ppStatus: status }), true, `camel ${status}`)
  }
  assert.equal(rowIsHeldOrOut({ ...row('live', 3, 2.5), pp_status: 'pre_game' }), false)
})

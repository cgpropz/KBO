import assert from 'node:assert/strict'
import test from 'node:test'
import { shapeForTier } from '../api/_dataAccess.js'
import { prepareBoardRows } from '../src/nhl/pointsGate.js'
import { isStandardBoardLine } from '../src/standardBoard.js'

// Free rows plus the locked remainder are the rows a member still sees
// after prepareBoardRows. Pulled, removed, and non-standard lines are in
// neither count.

const FUTURE = '2099-01-01T00:00:00.000Z'
const PAST = '2000-01-01T00:00:00.000Z'
const PULLED = new Set(['removed', 'suspended', 'held', 'hold', 'onhold'])

const SPORTS = [
  { sport: 'kbo', ds: 'prizepicks_props', stat: 'Hits+Runs+RBIs' },
  { sport: 'wnba', ds: 'wnba_projections_standard', stat: 'Rebounds' },
  { sport: 'nfl', ds: 'nfl_projections', stat: 'Receptions' },
  { sport: 'nhl', ds: 'nhl_projections', stat: 'Shots On Goal' },
]

function row(stat, id, extra = {}) {
  const lineStat = extra.stat || stat
  const odds = extra.odds ?? 'standard'
  const line = {
    id,
    player: extra.player || id,
    name: extra.player || id,
    prop: lineStat,
    stat: lineStat,
    line: extra.line ?? 4.5,
    projection: extra.projection ?? 12,
    odds_type: odds,
    oddsType: odds,
    start_time: extra.start_time || FUTURE,
  }
  if (extra.removed === true) line.removed = true
  if (extra.pp_status) line.pp_status = extra.pp_status
  return line
}

function boardRows(sport) {
  const { stat } = sport
  const live = [30, 24, 20, 16, 12].map((projection, index) => (
    row(stat, `live-${index + 1}`, { projection })
  ))
  return [
    ...live,
    row(stat, 'extra', { player: 'live-1', projection: 11 }),
    row(stat, 'started', { projection: 80, start_time: PAST }),
    row(stat, 'held', { stat: 'Points', line: 0.5, projection: 0.74 }),
    row(stat, 'low', { stat: 'Points', line: 0.5, projection: 0.68 }),
    row(stat, 'removed', { projection: 99, removed: true }),
    row(stat, 'suspended', { projection: 99, pp_status: 'suspended' }),
    row(stat, 'pp-held', { projection: 99, pp_status: 'held' }),
    row(stat, 'hold', { projection: 99, pp_status: 'hold' }),
    row(stat, 'onhold', { projection: 99, pp_status: 'on-hold' }),
    row(stat, 'pp-removed', { projection: 99, pp_status: 'removed' }),
    row(stat, 'goblin', { projection: 99, odds: 'goblin' }),
    row(stat, 'demon', { projection: 99, odds: 'demon' }),
    row(stat, 'blank', { projection: 99, odds: '  ' }),
  ]
}

function payloadFor(ds, rows) {
  if (ds === 'nfl_projections' || ds === 'nhl_projections') return rows
  if (ds === 'prizepicks_props') {
    return {
      total_props: rows.length,
      cards: rows.map((line) => ({
        name: line.player,
        start_time: FUTURE,
        props: [line],
      })),
    }
  }
  return rows.map((line) => ({
    name: line.player,
    start_time: FUTURE,
    ppAllProps: [line],
  }))
}

function rowsFrom(ds, data) {
  if (ds === 'prizepicks_props') {
    const cards = Array.isArray(data?.cards) ? data.cards : []
    return cards.flatMap((card) => (Array.isArray(card?.props) ? card.props : []))
  }
  if (ds === 'wnba_projections_standard') {
    const players = Array.isArray(data) ? data : []
    return players.flatMap((player) => (Array.isArray(player?.ppAllProps) ? player.ppAllProps : []))
  }
  return Array.isArray(data) ? data : []
}

function isPulled(line) {
  if (line?.removed === true) return true
  const compact = String(line?.pp_status ?? line?.ppStatus ?? '').toLowerCase().replace(/[^a-z]/g, '')
  return PULLED.has(compact)
}

for (const sport of SPORTS) {
  test(`${sport.sport}: free count plus locked count equals member rows after prepareBoardRows`, () => {
    const raw = boardRows(sport)
    const expected = prepareBoardRows(raw.filter((line) => isStandardBoardLine(line)))
    const payload = payloadFor(sport.ds, raw)
    const free = shapeForTier(sport.ds, structuredClone(payload), 'free')
    const member = shapeForTier(sport.ds, structuredClone(payload), 'combined')
    const freeRows = rowsFrom(sport.ds, free.data)
    const memberRows = rowsFrom(sport.ds, member.data)

    assert.equal(free.preview, true)
    assert.equal(member.preview, false)
    assert.equal(member.lockedCount, 0)
    assert.deepEqual(memberRows.map((line) => line.id), expected.map((line) => line.id))
    assert.equal(freeRows.length + free.lockedCount, memberRows.length)
    assert.equal(freeRows.length + free.lockedCount, expected.length)

    for (const line of [...freeRows, ...memberRows]) {
      assert.equal(isPulled(line), false, line.id)
      assert.equal(isStandardBoardLine(line), true, line.id)
    }
    for (const id of ['low', 'removed', 'suspended', 'pp-held', 'hold', 'onhold', 'pp-removed', 'goblin', 'demon', 'blank']) {
      assert.equal(freeRows.some((line) => line.id === id), false, id)
      assert.equal(memberRows.some((line) => line.id === id), false, id)
    }

    assert.equal(freeRows.some((line) => line.id === 'started'), false)
    assert.equal(memberRows.some((line) => line.id === 'started'), true)
    assert.equal(freeRows.some((line) => line.id === 'held'), false)
    assert.equal(memberRows.find((line) => line.id === 'held')?.rankEligible, false)
    assert.equal(freeRows.length, 3)
    assert.ok(free.lockedCount > 0)
  })
}

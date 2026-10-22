import assert from 'node:assert/strict'
import test from 'node:test'
import { shapeForTier } from '../api/_dataAccess.js'
import { gameAlreadyStarted, startTimePassed } from '../src/gameStarted.js'

// Thursday 8:20 PM ET: the 8:15 PM ET game has kicked off; Sunday has not.
const NOW = new Date('2026-10-23T00:20:00Z')
const TNF = '2026-10-22T20:15:00.000-04:00'
const SUNDAY = '2026-10-25T13:00:00.000-04:00'

function nflRow(id, start, extra = {}) {
  return { id, player: `P ${id}`, team: 'NE', opponent: 'CHI', prop: 'Rush Yards', line: 40.5, projection: 60, odds_type: 'standard', start_time: start, ...extra }
}

const ids = (rows) => rows.map((row) => row.id)

test('startTimePassed: only a parseable start at or before now counts', () => {
  assert.equal(startTimePassed({ start_time: TNF }, NOW), true)
  assert.equal(startTimePassed({ start_time: '2026-10-23T00:20:00Z' }, NOW), true) // exactly now
  assert.equal(startTimePassed({ start_time: SUNDAY }, NOW), false)
  assert.equal(startTimePassed({ start_time: '2026-10-22 20:15' }, NOW), true) // ET wall clock
  for (const row of [{}, { start_time: '' }, { start_time: 'TBD' }, { start_time: null }, { gameday: '2026-10-21' }, { locked: true }, { started: true }]) {
    assert.equal(startTimePassed(row, NOW), false, JSON.stringify(row))
  }
  // gameAlreadyStarted (free top 3) is unchanged: flags and past gamedays still count there.
  assert.equal(gameAlreadyStarted({ gameday: '2026-10-21' }, NOW), true)
})

for (const ds of ['nfl_projections', 'nhl_projections']) {
  test(`${ds}: the member board drops started games per request and keeps unknown starts`, () => {
    const extra = ds === 'nhl_projections' ? { prop: 'Shots On Goal', stat: 'Shots On Goal', line: 2.5, projection: 4 } : {}
    const board = [
      nflRow('tnf', TNF, extra),
      nflRow('sunday', SUNDAY, extra),
      nflRow('no-start', '', extra),
      nflRow('bad-start', 'TBD', extra),
      nflRow('missing', undefined, extra),
    ]
    const before = structuredClone(board)
    const member = shapeForTier(ds, board, 'combined', { now: NOW })
    assert.equal(member.preview, false)
    assert.deepEqual(ids(member.data), ['sunday', 'no-start', 'bad-start', 'missing'])
    // Before kickoff the same row is on the board.
    const early = shapeForTier(ds, structuredClone(before), 'combined', { now: new Date('2026-10-22T23:00:00Z') })
    assert.ok(ids(early.data).includes('tnf'))
    // The snapshot passed in is not modified, and row order is untouched.
    assert.deepEqual(board, before)
  })
}

test('nfl_projections: the free preview locked count no longer counts started rows', () => {
  const board = [
    nflRow('tnf', TNF),
    ...Array.from({ length: 5 }, (_, i) => nflRow(`sun${i}`, SUNDAY, { projection: 60 + i })),
  ]
  const free = shapeForTier('nfl_projections', structuredClone(board), 'free', { now: NOW })
  const member = shapeForTier('nfl_projections', structuredClone(board), 'combined', { now: NOW })
  assert.equal(member.data.length, 5)
  assert.equal(free.data.length + free.lockedCount, member.data.length)
  assert.equal(ids(free.data).includes('tnf'), false)
})

test('other member boards are unchanged by the started filter', () => {
  const players = [{ name: 'W', team: 'LVA', ppAllProps: [{ stat: 'Points', line: 20.5, odds_type: 'standard', start_time: TNF, projection: 25 }] }]
  const member = shapeForTier('wnba_projections_standard', structuredClone(players), 'combined', { now: NOW })
  assert.equal(member.data[0].ppAllProps.length, 1)
})

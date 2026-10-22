import test from 'node:test'
import assert from 'node:assert/strict'
import { buildBoardStatus } from '../src/boardFreshness.js'
import { publicBoardStatus } from '../api/_boardStatus.js'

const OLD = '2026-10-21T16:09:28-04:00'
const now = new Date('2026-10-22T16:30:00Z')
const kboOf = (doc) => doc.boards.find((row) => row.sport === 'kbo')

test('an empty KBO board keeps the no_lines note and the last real clock', () => {
  const previous = [{ sport: 'kbo', board_updated_at: OLD, prop_count: 0, stale: true, note: 'no_lines' }]
  const fresh = { data: { cards: [], generated_at: '2026-10-22T16:20:00Z' } }
  for (const snapshots of [{}, { kbo: fresh }]) {
    const kbo = kboOf(buildBoardStatus({ snapshots, previous, now }))
    assert.equal(kbo.note, 'no_lines')
    assert.equal(kbo.prop_count, 0)
    assert.equal(kbo.stale, true)
    assert.equal(kbo.board_updated_at, OLD)
  }
})

test('KBO props clear the no_lines note', () => {
  const previous = [{ sport: 'kbo', board_updated_at: OLD, prop_count: 0, stale: true, note: 'no_lines' }]
  const snapshots = { kbo: { data: { cards: [{ props: [{}, {}] }], generated_at: '2026-10-22T16:20:00Z' } } }
  const kbo = kboOf(buildBoardStatus({ snapshots, previous, now }))
  assert.equal(kbo.note, undefined)
  assert.equal(kbo.prop_count, 2)
})

test('the status API passes the note only on KBO', () => {
  const doc = publicBoardStatus({ boards: [
    { sport: 'kbo', board_updated_at: OLD, prop_count: 0, stale: true, note: 'no_lines' },
    { sport: 'nfl', board_updated_at: OLD, prop_count: 3, stale: false, note: 'no_lines' },
  ] })
  assert.equal(kboOf(doc).note, 'no_lines')
  assert.equal(doc.boards.find((row) => row.sport === 'nfl').note, undefined)
})

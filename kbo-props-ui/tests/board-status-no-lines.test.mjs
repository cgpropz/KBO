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

test('the status API passes the note on KBO and WNBA', () => {
  const doc = publicBoardStatus({ boards: [
    { sport: 'kbo', board_updated_at: OLD, prop_count: 0, stale: true, note: 'no_lines' },
    { sport: 'wnba', board_updated_at: OLD, prop_count: 0, stale: true, note: 'no_lines' },
    { sport: 'nfl', board_updated_at: OLD, prop_count: 3, stale: false, note: 'no_lines' },
  ] })
  assert.equal(kboOf(doc).note, 'no_lines')
  assert.equal(doc.boards.find((row) => row.sport === 'wnba').note, 'no_lines')
  assert.equal(doc.boards.find((row) => row.sport === 'nfl').note, undefined)
})

test('an empty WNBA ppLines map is no_lines and does not move the clock', () => {
  const previous = [{ sport: 'wnba', board_updated_at: OLD, prop_count: 101, stale: false }]
  const publishedAt = '2026-10-22T16:20:00Z'
  const ghost = {
    publishedAt,
    data: [{
      name: 'Veronica Burton',
      ppLines: { pts: null, reb: null, ast: null },
      ppAllProps: [{ stat: 'Offensive Rebounds', line: 0.5, projection: 0.85 }],
    }],
  }
  const empty = { publishedAt, data: [{ name: 'Naz Hillmon', ppLines: {}, ppAllProps: [{ stat: 'Points', line: 5.5 }] }] }
  for (const snap of [ghost, empty]) {
    const wnba = buildBoardStatus({ snapshots: { wnba: snap }, previous, now }).boards.find((row) => row.sport === 'wnba')
    assert.equal(wnba.note, 'no_lines')
    assert.equal(wnba.prop_count, 0)
    assert.equal(wnba.stale, true)
    assert.equal(wnba.board_updated_at, OLD)
  }
})

test('WNBA ppLines clear the no_lines note', () => {
  const previous = [{ sport: 'wnba', board_updated_at: OLD, prop_count: 0, stale: true, note: 'no_lines' }]
  const snapshots = {
    wnba: {
      publishedAt: '2026-10-22T16:20:00Z',
      data: [{ ppLines: { pts: 22.5, reb: null, ast: 2.5 }, ppAllProps: [{ line: 1 }] }],
    },
  }
  const wnba = buildBoardStatus({ snapshots, previous, now }).boards.find((row) => row.sport === 'wnba')
  assert.equal(wnba.note, undefined)
  assert.equal(wnba.prop_count, 2)
  assert.equal(wnba.stale, false)
  assert.notEqual(wnba.board_updated_at, OLD)
})

test('a missing WNBA snapshot keeps an existing no_lines note', () => {
  const previous = [{ sport: 'wnba', board_updated_at: OLD, prop_count: 0, stale: true, note: 'no_lines' }]
  const wnba = buildBoardStatus({ snapshots: {}, previous, now }).boards.find((row) => row.sport === 'wnba')
  assert.equal(wnba.note, 'no_lines')
  assert.equal(wnba.prop_count, 0)
  assert.equal(wnba.board_updated_at, OLD)
})

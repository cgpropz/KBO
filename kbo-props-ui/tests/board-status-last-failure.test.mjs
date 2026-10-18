import assert from 'node:assert/strict'
import test from 'node:test'
import { buildBoardStatus } from '../src/boardFreshness.js'

const failure = { reason: 'download_failed', missing: ['2025/skaters/VGK'], at: '2026-10-18T11:20:00-04:00' }
const previous = [{ sport: 'nhl', board_updated_at: '2026-10-18T10:50:00-04:00', prop_count: 249, last_failure: failure }]
const now = new Date('2026-10-18T15:30:00Z')

test('a frontend build without the NHL snapshot keeps the download-failed reason', () => {
  const nhl = buildBoardStatus({ snapshots: {}, previous, now }).boards.find((row) => row.sport === 'nhl')
  assert.deepEqual(nhl.last_failure, failure)
  assert.equal(nhl.prop_count, 249)
})

test('an unknown failure reason is not copied', () => {
  const odd = [{ ...previous[0], last_failure: { reason: 'something', missing: [] } }]
  const nhl = buildBoardStatus({ snapshots: {}, previous: odd, now }).boards.find((row) => row.sport === 'nhl')
  assert.equal('last_failure' in nhl, false)
})

import assert from 'node:assert/strict'
import { test } from 'node:test'
import { selectFreeTop3 } from '../src/freeTopPicks.js'

const NOW = new Date('2026-10-16T16:00:00Z')

test('free top 3 skips started and held NHL points overs and backfills', () => {
  const rows = [
    { player: 'Started', stat: 'Points', projection: 2, line: 0.5, score: 100, start_time: '2020-01-01T00:00:00Z' },
    { player: 'Held', stat: 'Points', projection: 0.74, line: 0.5, score: 90 },
    { player: 'Removed', stat: 'Shots', projection: 3, line: 2.5, score: 85, removed: true },
    { player: 'A', stat: 'Shots', projection: 3, line: 2.5, score: 80 },
    { player: 'B', stat: 'Shots', projection: 3, line: 2.5, score: 70 },
    { player: 'Promoted', stat: 'Points', projection: 0.9, line: 0.5, score: 60 },
    { player: 'C', stat: 'Shots', projection: 3, line: 2.5, score: 50 },
  ]
  assert.deepEqual(selectFreeTop3(rows, 'nhl', NOW).map((row) => row.player), ['A', 'B', 'Promoted'])
})

test('a locked or already-started flag does not take a free slot', () => {
  const rows = [
    { player: 'Locked', stat: 'Hits', projection: 1.4, line: 0.5, score: 40, locked: true },
    { player: 'Live', stat: 'Hits', projection: 1.2, line: 0.5, score: 20 },
    { player: 'Next', stat: 'Hits', projection: 1.1, line: 0.5, score: 10 },
    { player: 'Third', stat: 'Hits', projection: 1.05, line: 0.5, score: 5 },
  ]
  assert.deepEqual(selectFreeTop3(rows, 'kbo', NOW).map((row) => row.player), ['Live', 'Next', 'Third'])
})

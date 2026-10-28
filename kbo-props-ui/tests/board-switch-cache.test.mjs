import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { createDatasetCache, datasetCacheKey, DATASET_CACHE_TTL_MS } from '../src/datasetCache.js'
import { rankWithTipLanes } from '../src/stableBoard.js'
import { cachedLivePack, clearLivePacks, rememberLivePack } from '../src/cheatsheets/packCache.js'

test('a cached board is reused until it expires, and fresh callers can replace it', () => {
  let now = 1_000
  const cache = createDatasetCache({ now: () => now })
  const key = datasetCacheKey('nfl_projections', { showAllLines: false })
  const full = { data: [{ id: 'a' }], preview: false }
  cache.write(key, full)
  assert.equal(cache.read(key), full)
  now += DATASET_CACHE_TTL_MS + 1
  assert.equal(cache.read(key), null)
  cache.write(key, full)
  const again = { data: [{ id: 'b' }], preview: false }
  cache.write(key, again)
  assert.equal(cache.read(key), again)
  assert.equal(datasetCacheKey('nfl_projections', { player: 'A' }), datasetCacheKey('nfl_projections', { player: 'A' }))
  assert.notEqual(
    datasetCacheKey('nfl_projections', {}),
    datasetCacheKey('nfl_projections', { showAllLines: true }),
  )
})

test('filtering a ranked slate keeps the same row objects', () => {
  const rows = [
    { id: 'low', score: 10, side: 'UNDER' },
    { id: 'tip', score: 90, side: 'OVER' },
    { id: 'second', score: 80, side: 'UNDER' },
    { id: 'third', score: 70, side: 'UNDER' },
    { id: 'later', score: 20, side: 'OVER' },
  ]
  const ranked = rankWithTipLanes(rows, (a, b) => b.score - a.score, (row) => row.id)
  assert.equal(ranked[0].id, 'tip')
  assert.equal(ranked[0].tipLane, 'tip')
  assert.equal(ranked[3].id, 'later')
  assert.equal(ranked[3].tipLane, 'unproven')
  const overs = ranked.filter((row) => row.side === 'OVER')
  assert.equal(overs[0], ranked[0])
  assert.equal(overs[1], ranked[3])
  assert.equal(overs[1].tipLane, 'unproven')
})

test('a cheatsheet sport tab can reuse a pack that already loaded', () => {
  clearLivePacks()
  const pack = { games: [{ id: 'g1' }], status: 'live' }
  assert.equal(cachedLivePack('nfl'), null)
  rememberLivePack('nfl', pack, 5_000)
  assert.equal(cachedLivePack('nfl', 5_000 + 1000), pack)
  assert.equal(cachedLivePack('nfl', 5_000 + 5 * 60 * 1000 + 1), null)
  clearLivePacks()
})

test('dataset fetches skip the session cache on a fresh or retried pull', () => {
  const source = readFileSync(new URL('../src/apiData.js', import.meta.url), 'utf8')
  assert.match(source, /if \(!fresh && !retried\)/)
  assert.match(source, /datasetCache\.read/)
  assert.match(source, /clearDatasetCache/)
  assert.match(source, /cachedMemberPreviewIsDowngrade/)
})

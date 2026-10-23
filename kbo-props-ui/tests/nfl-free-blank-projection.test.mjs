import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { nflHasProjection } from '../src/nfl/nflLineFloors.js'
import { DATASETS } from '../api/_dataAccess.js'

const later = () => new Date(Date.now() + 3 * 60 * 60 * 1000).toISOString()

test('nflHasProjection: blank, null, non-numeric and <= 0 are not projections', () => {
  for (const v of [null, undefined, '', '   ', 'abc', NaN, 0, '0', -1.5, '-2']) {
    assert.equal(nflHasProjection(v), false, String(v))
  }
  for (const v of [0.1, 3.8, '3.8', 64]) assert.equal(nflHasProjection(v), true, String(v))
})

test('NFL free preview: blank and <= 0 projections never take a free slot', () => {
  const res = DATASETS.nfl_projections.free([
    { player: 'Null Proj', prop: 'Receptions', projection: null, line: 3.5, start_time: later() },
    { player: 'Empty Proj', prop: 'Receptions', projection: '', line: 3.5, start_time: later() },
    { player: 'Missing Proj', prop: 'Receptions', line: 3.5, start_time: later() },
    { player: 'Zero Proj', prop: 'Receptions', projection: 0, line: 3.5, start_time: later() },
    { player: 'Negative Proj', prop: 'Receptions', projection: -1, line: 3.5, start_time: later() },
    { player: 'Real Under', prop: 'Receptions', projection: 2.9, line: 3.5, start_time: later() },
  ])
  // Fewer than 3 eligible players: only the real projection is shown.
  assert.deepEqual(res.data.map((row) => row.player), ['Real Under'])
})

test('NFL free preview: a blank row does not displace the same player\'s real prop', () => {
  const res = DATASETS.nfl_projections.free([
    { player: 'Same Guy', prop: 'Receptions', projection: null, line: 3.5, start_time: later() },
    { player: 'Same Guy', prop: 'Receiving Yards', projection: 30.5, line: 40.5, start_time: later() },
  ])
  assert.deepEqual(res.data.map((row) => [row.player, row.prop]), [['Same Guy', 'Receiving Yards']])
})

test('FreePicksPreview nflFreeScore checks the projection before scoring', () => {
  const src = readFileSync(new URL('../src/FreePicksPreview.jsx', import.meta.url), 'utf8')
  const body = src.slice(src.indexOf('function nflFreeScore'), src.indexOf('function nhlFreeScore'))
  assert.match(body, /if \(!nflHasProjection\(row\.projection\)\) return -Infinity;/)
  assert.ok(body.indexOf('nflHasProjection') < body.indexOf('nflCgScore('))
})

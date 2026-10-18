import assert from 'node:assert/strict'
import test from 'node:test'
import { dropHitsRows, hitsPublic, hitsTabVisible, isHitsRow } from '../src/nhl/hitsGate.js'
import { isLiveFreePick } from '../src/freeTopPicks.js'
import { shapeForTier } from '../api/_dataAccess.js'

const FUTURE = '2099-01-01T00:00:00Z'
const rows = [
  { id: 1, player: 'Shooter', prop: 'Shots On Goal', line: 2.5, projection: 3.4, oddsType: 'standard', start_time: FUTURE },
  { id: 2, player: 'Hitter', prop: 'Hits', line: 2.5, projection: 4.1, oddsType: 'standard', rankEligible: false, adminOnly: true, start_time: FUTURE },
]

test('Hits rows are recognised by prop or stat', () => {
  assert.equal(isHitsRow({ prop: 'Hits' }), true)
  assert.equal(isHitsRow({ stat: 'hits' }), true)
  assert.equal(isHitsRow({ prop: 'Shots On Goal' }), false)
  assert.deepEqual(dropHitsRows(rows).map((row) => row.id), [1])
  assert.deepEqual(dropHitsRows(rows, { allow: true }).map((row) => row.id), [1, 2])
})

test('the Hits tab is dev ?nhlhits=1 or an explicit build flag only', () => {
  assert.equal(hitsTabVisible(false, '?nhlhits=1', undefined), false)
  assert.equal(hitsTabVisible(true, '?nhlhits=1', undefined), true)
  assert.equal(hitsTabVisible(true, '', undefined), false)
  assert.equal(hitsTabVisible(false, '', '1'), true)
  assert.equal(hitsPublic({}), false)
  assert.equal(hitsPublic({ NHL_HITS_PUBLIC: '1' }), true)
})

test('member and free NHL payloads drop Hits unless NHL_HITS_PUBLIC=1', () => {
  const before = process.env.NHL_HITS_PUBLIC
  try {
    delete process.env.NHL_HITS_PUBLIC
    for (const tier of ['owner', 'free']) {
      const shaped = shapeForTier('nhl_projections', rows, tier)
      const data = Array.isArray(shaped) ? shaped : shaped.data
      assert.equal(data.some(isHitsRow), false, tier)
    }
    process.env.NHL_HITS_PUBLIC = '1'
    const paid = shapeForTier('nhl_projections', rows, 'owner')
    assert.equal((Array.isArray(paid) ? paid : paid.data).some(isHitsRow), true)
    const free = shapeForTier('nhl_projections', rows, 'free')
    assert.equal((Array.isArray(free) ? free : free.data).some(isHitsRow), false, 'never in the free preview')
  } finally {
    if (before === undefined) delete process.env.NHL_HITS_PUBLIC
    else process.env.NHL_HITS_PUBLIC = before
  }
})

test('Hits is never a free top 3 pick, even if a row were rank-eligible', () => {
  const row = { player: 'Hitter', stat: 'Hits', line: 2.5, projection: 4.1, score: 82, start_time: FUTURE }
  assert.equal(isLiveFreePick(row, 'nhl'), false)
  assert.equal(isLiveFreePick({ ...row, stat: 'Shots On Goal' }, 'nhl'), true)
})

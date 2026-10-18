import test from 'node:test'
import assert from 'node:assert/strict'
import { edgeSide, pickSide, sideClass, sideLetter } from '../src/pickSide.js'
import { nhlHubRows } from '../src/memberHub.js'

test('a projection on the line, or a CG of exactly 50, has no side', () => {
  assert.equal(pickSide(4.5, 4.5), null)
  assert.equal(pickSide(4.6, 4.5), 'OVER')
  assert.equal(pickSide(4.4, 4.5), 'UNDER')
  assert.equal(pickSide(6, 4.5, 50), null)
  assert.equal(pickSide(null, 4.5), null)
  assert.equal(sideClass(null), 'neutral')
  assert.equal(sideClass('OVER'), 'over')
  assert.equal(sideLetter(null), '')
  assert.equal(sideLetter('UNDER'), 'U')
})

test('an edge of exactly 0 is EVEN', () => {
  assert.equal(edgeSide(0), 'EVEN')
  assert.equal(edgeSide(0.1), 'OVER')
  assert.equal(edgeSide(-0.1), 'UNDER')
  assert.equal(edgeSide(null), null)
})

test('hub rows on the line carry no side (no O/U letter)', () => {
  const nhl = nhlHubRows([
    { player: 'Even Skater', prop: 'Shots On Goal', projection: 2.5, line: 2.5, odds_type: 'standard' },
    { player: 'Over Skater', prop: 'Shots On Goal', projection: 3.1, line: 2.5, odds_type: 'standard' },
  ])
  assert.equal(nhl.find((r) => r.player === 'Even Skater').side, null)
  assert.equal(nhl.find((r) => r.player === 'Over Skater').side, 'OVER')
})

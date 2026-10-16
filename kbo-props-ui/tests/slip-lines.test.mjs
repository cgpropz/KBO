import assert from 'node:assert/strict'
import { test } from 'node:test'
import { isPromoLine, isStandardLine, matchImportedPick, oddsTypeOf } from '../src/slipLines.js'

test('odds type reads odds_type, oddsType, and line_type', () => {
  assert.equal(oddsTypeOf({ odds_type: 'demon' }), 'demon')
  assert.equal(oddsTypeOf({ oddsType: 'Demon' }), 'demon')
  assert.equal(oddsTypeOf({ line_type: 'goblin' }), 'goblin')
  assert.equal(oddsTypeOf({ lineType: 'GOBLIN' }), 'goblin')
  assert.equal(oddsTypeOf({}), 'standard')
  assert.equal(oddsTypeOf({ oddsType: 'standard' }), 'standard')
  assert.equal(isPromoLine({ oddsType: 'demon' }), true)
  assert.equal(isPromoLine({ line_type: 'standard' }), false)
  assert.equal(isStandardLine({ line_type: 'demon' }), false)
  assert.equal(isStandardLine({}), true)
})

test('import prefers the standard row and can target a line', () => {
  const props = [
    { name: 'Nazem Kadri', prop: 'Shots On Goal', team: 'CGY', opponent: 'EDM', line: 6.5, odds_type: 'demon' },
    { name: 'Nazem Kadri', prop: 'Shots On Goal', team: 'CGY', opponent: 'EDM', line: 2.5, odds_type: 'standard' },
  ]
  assert.equal(matchImportedPick(props, {
    name: 'Nazem Kadri', prop: 'Shots On Goal', team: 'CGY', opponent: 'EDM',
  }), 1)
  assert.equal(matchImportedPick(props, {
    name: 'Nazem Kadri', prop: 'Shots On Goal', team: 'CGY', opponent: 'EDM', line: 6.5, odds_type: 'demon',
  }), 0)
  assert.equal(matchImportedPick(props, {
    name: 'Nazem Kadri', prop: 'Shots On Goal', team: 'CGY', opponent: 'EDM', line: 2.5,
  }), 1)
})

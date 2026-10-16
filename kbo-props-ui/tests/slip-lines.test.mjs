import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'
import { isPromoLine, isStandardLine, matchImportedPick, oddsTypeOf, standardSlipRows } from '../src/slipLines.js'

test('each sport field keeps standard and drops demon, goblin, blank, and unknown', () => {
  const kept = standardSlipRows([
    { name: 'KBO', prop: 'Strikeouts', odds_type: 'standard' },
    { name: 'KBO demon', prop: 'Strikeouts', odds_type: 'demon' },
    { name: 'WNBA', prop: 'Points', odds_type: 'Standard' },
    { name: 'WNBA goblin', prop: 'Points', odds_type: 'goblin' },
    { name: 'NBA', prop: 'Rebounds', odds_type: 'standard' },
    { name: 'NBA blank', prop: 'Rebounds' },
    { player: 'NHL', prop: 'Shots On Goal', oddsType: 'standard' },
    { player: 'NHL demon', prop: 'Shots On Goal', oddsType: 'demon' },
    { player: 'NFL', prop: 'Receiving Yards', line_type: 'standard' },
    { player: 'NFL goblin', prop: 'Receiving Yards', line_type: 'goblin' },
    { player: 'NFL unknown', prop: 'Rush Yards', line_type: 'boost' },
    { player: 'NFL blank type', prop: 'Receptions', line_type: '  ' },
  ])
  assert.deepEqual(kept.map((row) => row.name || row.player), ['KBO', 'WNBA', 'NBA', 'NHL', 'NFL'])
  assert.equal(oddsTypeOf({ odds_type: 'demon' }), 'demon')
  assert.equal(oddsTypeOf({ oddsType: 'Demon' }), 'demon')
  assert.equal(oddsTypeOf({ line_type: 'goblin' }), 'goblin')
  assert.equal(oddsTypeOf({ lineType: 'GOBLIN' }), 'goblin')
  assert.equal(oddsTypeOf({}), '')
  assert.equal(oddsTypeOf({ odds_type: 'discount' }), '')
  assert.equal(isStandardLine({ odds_type: 'standard' }), true)
  assert.equal(isStandardLine({ oddsType: 'standard' }), true)
  assert.equal(isStandardLine({ line_type: 'standard' }), true)
  assert.equal(isStandardLine({ lineType: 'standard' }), true)
  assert.equal(isStandardLine({}), false)
  assert.equal(isStandardLine({ oddsType: 'goblin' }), false)
  assert.equal(isStandardLine({ line_type: 'demon' }), false)
  assert.equal(isPromoLine({ oddsType: 'demon' }), true)
  assert.equal(isPromoLine({ line_type: 'standard' }), false)
  assert.equal(isPromoLine({}), false)
})

test('import matches a standard line and skips demon and goblin rows', () => {
  const props = [
    { name: 'Nazem Kadri', prop: 'Shots On Goal', team: 'CGY', opponent: 'EDM', line: 6.5, oddsType: 'demon' },
    { name: 'Nazem Kadri', prop: 'Shots On Goal', team: 'CGY', opponent: 'EDM', line: 2.5, oddsType: 'standard' },
    { name: 'Troy Franklin', prop: 'Receiving Yards', team: 'DEN', opponent: 'SEA', line: 40.5, line_type: 'goblin' },
    { name: 'Troy Franklin', prop: 'Receiving Yards', team: 'DEN', opponent: 'SEA', line: 17.5, line_type: 'standard' },
  ]
  assert.equal(matchImportedPick(props, {
    name: 'Nazem Kadri', prop: 'Shots On Goal', team: 'CGY', opponent: 'EDM',
  }), 1)
  assert.equal(matchImportedPick(props, {
    name: 'Nazem Kadri', prop: 'Shots On Goal', team: 'CGY', opponent: 'EDM', line: 6.5, oddsType: 'demon',
  }), -1)
  assert.equal(matchImportedPick(props, {
    name: 'Nazem Kadri', prop: 'Shots On Goal', team: 'CGY', opponent: 'EDM', line: 2.5,
  }), 1)
  assert.equal(matchImportedPick(props, {
    name: 'Troy Franklin', prop: 'Receiving Yards', team: 'DEN', opponent: 'SEA', line: 17.5, line_type: 'standard',
  }), 3)
})

test('flat rows and the WNBA loader stay on the standard table', () => {
  const source = readFileSync(new URL('../src/slipSports.js', import.meta.url), 'utf8')
  const flatStart = source.indexOf('function flatRows')
  const flatEnd = source.indexOf('const chip', flatStart)
  const flat = source.slice(flatStart, flatEnd)
  assert.match(flat, /standardSlipRows\(rows\)/)
  assert.match(flat, /isStandardLine\(row\)/)
  assert.equal(source.includes('projections_demon.json'), false)
  assert.equal(source.includes('projections_goblin.json'), false)
  assert.match(source, /projections_standard\.json/)
  const wnba = source.slice(source.indexOf("id: 'wnba'"), source.indexOf("id: 'nba'"))
  assert.match(wnba, /loadBasketProps/)
})

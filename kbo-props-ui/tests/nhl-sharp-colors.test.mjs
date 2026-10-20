import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import { hitRateColor, priceColor, PRICE_GREEN, PRICE_RED } from '../src/nfl/ppBoardColors.js'
import {
  nhlDisplayedGrade,
  nhlMatchupGrade,
  projectionVsLineColor,
} from '../src/nhl/nhlSharpDisplay.js'

const source = readFileSync(new URL('../src/nhl/NhlSharpOdds.jsx', import.meta.url), 'utf8')
const css = readFileSync(new URL('../src/nhl/nhl.css', import.meta.url), 'utf8')
const phone = readFileSync(new URL('../src/mobile.css', import.meta.url), 'utf8')

test('matchup reads dvpRank and ignores an A+ edge grade', () => {
  const row = {
    player: 'Sample Center',
    grade: 'A+',
    grade_flex: 'A+',
    grade_power: 'A+',
    dvpRank: 9,
    hitRateL5: 25,
    pp_edge_flex: 8.3,
    recommendation: 'UNDER',
  }
  assert.equal(nhlMatchupGrade(row), 'C+')
  assert.equal(nhlDisplayedGrade(row, 'flex'), 'A+')
  assert.notEqual(nhlMatchupGrade(row), nhlDisplayedGrade(row, 'flex'))
})

test('a missing matchup rank and a missing grade stay blank', () => {
  assert.equal(nhlMatchupGrade({ grade: 'A+', dvpRank: null }), null)
  assert.equal(nhlMatchupGrade({ grade: 'A+', dvpRank: 0 }), null)
  assert.equal(nhlDisplayedGrade({ dvpRank: 32, pp_edge_flex: null, recommendation: null }), null)
  assert.equal(nhlDisplayedGrade({ grade: '', grade_flex: '', dvpRank: 32 }), null)
})

test('an over projection uses the hit-rate anchors against the line', () => {
  assert.equal(projectionVsLineColor(6, 5, 'over'), hitRateColor(70))
  assert.equal(projectionVsLineColor(4, 5, 'over'), hitRateColor(30))
  assert.equal(projectionVsLineColor(5, 5, 'over'), hitRateColor(50))
  assert.equal(projectionVsLineColor(null, 2, 'over'), null)
  assert.equal(projectionVsLineColor(2, null, 'over'), null)
  assert.notEqual(projectionVsLineColor(6, 5, 'over'), projectionVsLineColor(4, 5, 'over'))
})

function greenChannel(color) {
  const match = String(color).match(/rgb\(\d+, (\d+), \d+\)/)
  assert.ok(match, color)
  return Number(match[1])
}

test('an under projection below the line is green, including 1.9 against 2', () => {
  const under = projectionVsLineColor(1.9, 2, 'under')
  const over = projectionVsLineColor(1.9, 2, 'over')
  const neutral = greenChannel(hitRateColor(50))
  assert.ok(greenChannel(under) > neutral)
  assert.ok(greenChannel(over) < neutral)
  assert.equal(under, projectionVsLineColor(2.1, 2, 'over'))
  assert.equal(projectionVsLineColor(4, 5, 'under'), hitRateColor(70))
  assert.equal(projectionVsLineColor(6, 5, 'under'), hitRateColor(30))
  assert.equal(projectionVsLineColor(5, 5, 'under'), hitRateColor(50))
  assert.equal(projectionVsLineColor(1.6, 2, 'under'), hitRateColor(70))
  assert.equal(projectionVsLineColor(2.4, 2, 'under'), hitRateColor(30))
})

test('a projection with no pick side stays uncolored', () => {
  assert.equal(projectionVsLineColor(1.9, 2), null)
  assert.equal(projectionVsLineColor(1.9, 2, null), null)
  assert.equal(projectionVsLineColor(6, 5, ''), null)
})

test('best prices keep the NFL flex color direction', () => {
  assert.equal(priceColor(-170, -119), PRICE_GREEN)
  assert.equal(priceColor(156, -119), PRICE_RED)
})

test('the NHL odds table uses the NFL color helpers and stays two-up on a phone', () => {
  assert.match(source, /nhlMatchupGrade/)
  assert.match(source, /projectionVsLineColor\(item\.projection, item\.pp_line, nhlScoredSide\(item\)\)/)
  assert.match(source, /priceColor/)
  assert.match(source, /hitRateColor/)
  assert.equal(source.includes('item.grade || dvpGrade'), false)
  assert.equal(source.includes('nfl-sharp-table has-cg'), false)
  assert.match(source, /nhl-sharp-table/)
  assert.match(css, /table\.nhl-sharp-table\[data-card-table\] > tbody/)
  assert.match(css, /grid-template-columns: repeat\(2, minmax\(0, 1fr\)\)/)
  assert.match(phone, /\.nfl-root table\.nfl-sharp-table\.has-cg\[data-card-table\] > tbody/)
})

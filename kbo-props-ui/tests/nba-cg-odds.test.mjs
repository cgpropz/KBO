import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { computeCgOdds, impliedProbability } from '../src/nfl/cgOdds.js'
import { nbaActiveEdge, nbaScoredSide } from '../src/nba/nbaSharpDisplay.js'

const FLEX = 119 / 219
const HERO = 'CG odds. Sniper Bot spec method: power de-vig, weighted book blend, line shift. Weights are unfitted priors; not backtested.'
const COLUMN = 'CG fair odds, fair win% for the PrizePicks side, and edge vs the selected PrizePicks break-even. Sniper Bot spec method, unfitted priors, not backtested.'

function read(path) {
  return readFileSync(new URL(path, import.meta.url), 'utf8')
}

function multiplicativeFair(overAmerican, underAmerican) {
  const over = impliedProbability(overAmerican)
  const under = impliedProbability(underAmerican)
  const total = over + under
  return { over: over / total, under: under / total }
}

function storedEdge(probability) {
  return Math.round((probability - FLEX) * 1000) / 10
}

function rowFromPrices({ prop, ppLine, matchedLine, recommendation, over, under }) {
  const fair = multiplicativeFair(over, under)
  return {
    player: 'Sample Guard',
    prop,
    pp_line: ppLine,
    matched_line: matchedLine,
    recommendation,
    book_prices: [{ book: 'Pinnacle', book_key: 'pinnacle', over, under }],
    pp_edge_over_flex: storedEdge(fair.over),
    pp_edge_under_flex: storedEdge(fair.under),
  }
}

function assertSameDirection(item, side) {
  const cg = computeCgOdds(item, side, FLEX)
  const shown = side === nbaScoredSide(item)
    ? nbaActiveEdge(item, 'flex')
    : item[`pp_edge_${side}_flex`]
  assert.ok(cg, `${item.prop} ${side}`)
  assert.notEqual(cg.edgePct, 0, `${item.prop} ${side}`)
  assert.notEqual(shown, 0, `${item.prop} ${side}`)
  assert.equal(Math.sign(cg.edgePct), Math.sign(shown), `${item.prop} ${side} CG ${cg.edgePct} PP ${shown}`)
}

test('CG odds and PP Edge agree in direction on NBA rows', () => {
  const overRow = rowFromPrices({
    prop: 'Points',
    ppLine: 26.5,
    matchedLine: 26.5,
    recommendation: 'OVER',
    over: -300,
    under: 220,
  })
  const underRow = rowFromPrices({
    prop: 'Rebounds',
    ppLine: 7.5,
    matchedLine: 7.5,
    recommendation: 'UNDER',
    over: 180,
    under: -220,
  })
  const shifted = rowFromPrices({
    prop: 'Points',
    ppLine: 20,
    matchedLine: 19.5,
    recommendation: 'OVER',
    over: -300,
    under: 220,
  })

  assertSameDirection(overRow, 'over')
  assertSameDirection(overRow, 'under')
  assert.equal(nbaScoredSide(overRow), 'over')
  assert.ok(nbaActiveEdge(overRow, 'flex') > 0)
  assert.ok(computeCgOdds(overRow, 'over', FLEX).edgePct > 0)

  assertSameDirection(underRow, 'under')
  assertSameDirection(underRow, 'over')
  assert.equal(nbaScoredSide(underRow), 'under')
  assert.ok(nbaActiveEdge(underRow, 'flex') > 0)
  assert.ok(computeCgOdds(underRow, 'under', FLEX).edgePct > 0)
  assert.ok(computeCgOdds(underRow, 'over', FLEX).edgePct < 0)

  assert.equal(computeCgOdds(shifted, 'over', FLEX).lineAdjusted, true)
  assertSameDirection(shifted, 'over')
  assertSameDirection(shifted, 'under')
  assert.ok(computeCgOdds(shifted, 'over', FLEX).edgePct > 0)
  assert.ok(nbaActiveEdge(shifted, 'flex') > 0)
})

test('CG odds label and explainer match NFL and NHL', () => {
  const files = [
    '../src/nfl/NflSharpOdds.jsx',
    '../src/nhl/NhlSharpOdds.jsx',
    '../src/nba/NbaSharpOdds.jsx',
  ].map(read)
  for (const source of files) {
    assert.ok(source.includes(HERO))
    assert.ok(source.includes(COLUMN))
    assert.ok(source.includes('CG ODDS'))
    assert.ok(source.includes('>CG Odds<'))
  }
})

test('NBA phone cards stay two per row and the CG panel keeps its own label', () => {
  const nba = read('../src/nba/nba.css')
  assert.match(nba, /table\.nba-sharp-table\[data-card-table\] > tbody \{\s*grid-template-columns: repeat\(2, minmax\(0, 1fr\)\);/)
  const phone = read('../src/mobile.css')
  assert.match(phone, /\.nba-root table\[data-card-table\] > tbody > tr > td\.nfl-sharp-cg\[data-label\]::before \{\s*content: none;/)
})

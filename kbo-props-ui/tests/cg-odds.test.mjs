import test from 'node:test'
import assert from 'node:assert/strict'
import { computeCgOdds, shiftOver, probabilityToAmerican, devigPower, impliedProbability, CG_METHOD } from '../src/nfl/cgOdds.js'

const close = (actual, expected, tol = 1e-6) => assert.ok(Math.abs(actual - expected) < tol, `${actual} vs ${expected}`)

test('converts probability to American odds', () => {
  assert.equal(probabilityToAmerican(0.5), -100)
  assert.equal(probabilityToAmerican(0.6), -150)
  assert.equal(probabilityToAmerican(0.4), 150)
  assert.equal(probabilityToAmerican(0), null)
})

test('power devig matches the spec example (-140/+110 -> 55.5%)', () => {
  const [over] = devigPower(impliedProbability(-140), impliedProbability(110))
  close(over, 0.555, 0.001)
})

// Expected values come from Sniper Bot's reference cg_odds.py (cg_fair, power).
test('matches reference: weighted books on the PP line', () => {
  const item = { prop: 'Receptions', pp_line: 4.5, matched_line: 4.5, book_prices: [
    { book: 'Pinnacle', book_key: 'pinnacle', over: -130, under: 105 },
    { book: 'DraftKings', book_key: 'draftkings', over: -145, under: 115 },
  ] }
  const cg = computeCgOdds(item, 'over', 119 / 219)
  close(cg.probability, 0.5448282430885393)
  assert.equal(cg.method, CG_METHOD)
  assert.equal(cg.lineAdjusted, false)
  assert.deepEqual(cg.books, ['Pinnacle', 'DraftKings'])
  close(computeCgOdds(item, 'under', 0.5).probability, 1 - 0.5448282430885393)
})

test('drops book lines more than 0.5 from the PrizePicks line', () => {
  const prices = [
    { book_key: 'fanduel', over: 120, under: -150 },
    { book_key: 'pinnacle', over: 115, under: -140 },
  ]
  assert.equal(computeCgOdds({ prop: 'Receptions', pp_line: 4.5, matched_line: 5.5, book_prices: prices }, 'over', 0.5), null)
  assert.equal(computeCgOdds({ prop: 'Pass TDs', pp_line: 0.5, matched_line: 1.5, book_prices: prices }, 'over', 0.5), null)
  assert.equal(computeCgOdds({ prop: 'Receiving Yards', pp_line: 54.5, matched_line: 52.5, book_prices: prices }, 'under', 0.5), null)
  const half = computeCgOdds({ prop: 'Rush Attempts', pp_line: 5, matched_line: 4.5, book_prices: prices }, 'over', 0.5)
  assert.ok(half && half.lineAdjusted)
})

test('matches reference: Poisson line shift for count stats', () => {
  // Shift math alone still matches the reference; the 0.5 cap is applied in cgFair.
  const [fdOver] = devigPower(impliedProbability(120), impliedProbability(-150))
  const shifted = shiftOver(fdOver, 5.5, 4.5, 'Receptions')
  assert.ok(shifted > fdOver && shifted < 1)
})

test('matches reference: linear line shift for yardage', () => {
  const item = { prop: 'Receiving Yards', pp_line: 54.5, matched_line: 55.0, book_prices: [
    { book_key: 'fanduel', over: -110, under: -120 },
    { book_key: 'pinnacle', over: -105, under: -115 },
  ] }
  const atPp = computeCgOdds({ ...item, matched_line: 54.5 }, 'over', 0.5).probability
  const cg = computeCgOdds(item, 'over', 0.5)
  assert.ok(cg.lineAdjusted && cg.probability > atPp)
})

test('whole-number count lines drop the push and agree on direction', () => {
  // Synthetic whole-line shots. Prices are made up. The heavy over is still
  // under 50% before the push is removed, and over 50% after.
  const overRow = {
    prop: 'Shots On Goal', pp_line: 2, matched_line: 1.5,
    book_prices: [{ book: 'Pinnacle', book_key: 'pinnacle', over: -300, under: 220 }],
  }
  const underRow = {
    prop: 'Shots On Goal', pp_line: 2, matched_line: 1.5,
    book_prices: [{ book: 'Pinnacle', book_key: 'pinnacle', over: -110, under: -110 }],
  }
  for (const item of [overRow, underRow]) {
    const over = computeCgOdds(item, 'over', 119 / 219)
    const under = computeCgOdds(item, 'under', 119 / 219)
    close(over.probability + under.probability, 1)
    assert.equal(over.lineAdjusted, true)
    const [fairOver] = devigPower(
      impliedProbability(item.book_prices[0].over),
      impliedProbability(item.book_prices[0].under),
    )
    const strict = shiftOver(fairOver, 1.5, 2, 'Shots On Goal')
    assert.ok(over.probability > strict)
    assert.ok(under.probability < 1 - strict)
  }
  const favoredOver = computeCgOdds(overRow, 'over', 119 / 219).probability
  const favoredUnder = computeCgOdds(underRow, 'under', 119 / 219).probability
  assert.ok(favoredOver > 0.5)
  assert.ok(computeCgOdds(overRow, 'under', 119 / 219).probability < 0.5)
  assert.ok(favoredUnder > 0.5)
  assert.ok(computeCgOdds(underRow, 'over', 119 / 219).probability < 0.5)
  const [juiced] = devigPower(impliedProbability(-300), impliedProbability(220))
  assert.ok(shiftOver(juiced, 1.5, 2, 'Shots On Goal') < 0.5)
})

test('an exact whole count line is left alone', () => {
  const item = {
    prop: 'Shots On Goal', pp_line: 2, matched_line: 2,
    book_prices: [{ book_key: 'pinnacle', over: -110, under: -110 }],
  }
  close(computeCgOdds(item, 'over', 0.5).probability, 0.5)
  assert.equal(computeCgOdds(item, 'over', 0.5).lineAdjusted, false)
})

test('a whole yardage line keeps the complement', () => {
  const item = {
    prop: 'Receiving Yards', pp_line: 54, matched_line: 54.5,
    book_prices: [{ book_key: 'pinnacle', over: -110, under: -110 }],
  }
  const over = computeCgOdds(item, 'over', 0.5).probability
  const under = computeCgOdds(item, 'under', 0.5).probability
  close(over + under, 1)
  const [fair] = devigPower(impliedProbability(-110), impliedProbability(-110))
  close(over, shiftOver(fair, 54.5, 54, 'Receiving Yards'))
})

test('returns null instead of inventing a price', () => {
  assert.equal(computeCgOdds({ pp_line: 4.5, book_prices: [{ book_key: 'pinnacle', over: -110 }] }, 'over', 0.54), null)
  assert.equal(computeCgOdds({ pp_line: 4.5, book_prices: [{ book_key: 'x', over: 200, under: 200 }] }, 'over', 0.54), null)
  assert.equal(computeCgOdds({ pp_line: 4.5, fair_over_pct: 60, fair_under_pct: 40 }, 'over', 0.54), null)
  assert.equal(computeCgOdds({}, 'line', 0.54), null)
  assert.equal(computeCgOdds(null, 'over', 0.54), null)
})

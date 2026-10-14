import test from 'node:test'
import assert from 'node:assert/strict'
import { computeCgOdds, probabilityToAmerican, devigPower, impliedProbability, CG_METHOD } from '../src/nfl/cgOdds.js'

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

test('matches reference: Poisson line shift for count stats', () => {
  const item = { prop: 'Receptions', pp_line: 4.5, matched_line: 5.5, book_prices: [
    { book_key: 'fanduel', over: 120, under: -150 },
    { book_key: 'pinnacle', over: 115, under: -140 },
  ] }
  const cg = computeCgOdds(item, 'over', 0.5)
  close(cg.probability, 0.6099254265879207, 1e-4)
  assert.equal(cg.lineAdjusted, true)
})

test('matches reference: linear line shift for yardage', () => {
  const item = { prop: 'Receiving Yards', pp_line: 54.5, matched_line: 55.5, book_prices: [
    { book_key: 'fanduel', over: -110, under: -120 },
    { book_key: 'pinnacle', over: -105, under: -115 },
  ] }
  close(computeCgOdds(item, 'over', 0.5).probability, 0.5004956563242893, 1e-6)
})

test('returns null instead of inventing a price', () => {
  assert.equal(computeCgOdds({ pp_line: 4.5, book_prices: [{ book_key: 'pinnacle', over: -110 }] }, 'over', 0.54), null)
  assert.equal(computeCgOdds({ pp_line: 4.5, book_prices: [{ book_key: 'x', over: 200, under: 200 }] }, 'over', 0.54), null)
  assert.equal(computeCgOdds({ pp_line: 4.5, fair_over_pct: 60, fair_under_pct: 40 }, 'over', 0.54), null)
  assert.equal(computeCgOdds({}, 'line', 0.54), null)
  assert.equal(computeCgOdds(null, 'over', 0.54), null)
})

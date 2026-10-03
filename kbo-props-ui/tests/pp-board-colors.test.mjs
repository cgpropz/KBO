import assert from 'node:assert/strict'
import test from 'node:test'
import { dvpGrade } from '../src/nfl/matchupGrade.js'
import {
  HIT_GREEN,
  HIT_NEUTRAL,
  HIT_RED,
  PRICE_GREEN,
  PRICE_NEUTRAL,
  PRICE_RED,
  bestAmerican,
  finiteNumber,
  hitRateColor,
  hitRateRgb,
  priceColor,
  priceEvLabel,
  priceTone,
} from '../src/nfl/ppBoardColors.js'

test('book -140 is green versus Flex -119 because PrizePicks is the better price', () => {
  assert.equal(priceTone(-140, -119), 'worse')
  assert.equal(priceColor(-140, -119), PRICE_GREEN)
  assert.equal(priceEvLabel(-140, -119), '+EV')
})

test('book -115 is red versus Flex -119 because the book is easier than PrizePicks', () => {
  assert.equal(priceTone(-115, -119), 'better')
  assert.equal(priceColor(-115, -119), PRICE_RED)
  assert.equal(priceEvLabel(-115, -119), '-EV')
})

test('Flex -119, book +140 is not green and is -EV', () => {
  assert.notEqual(priceColor(140, -119), PRICE_GREEN)
  assert.notEqual(priceColor('+140', -119), PRICE_GREEN)
  assert.equal(priceTone(140, -119), 'better')
  assert.equal(priceTone('+140', -119), 'better')
  assert.equal(priceColor(140, -119), PRICE_RED)
  assert.equal(priceColor('+140', -119), PRICE_RED)
  assert.equal(priceEvLabel(140, -119), '-EV')
  assert.equal(priceEvLabel('+140', -119), '-EV')
})

test('plus-money is compared on implied probability, not the raw string', () => {
  assert.equal(priceTone(100, -100), 'even')
  assert.equal(priceColor(100, -100), PRICE_NEUTRAL)
  assert.equal(priceEvLabel(100, -100), null)
  assert.equal(priceColor(140, -137), PRICE_RED)
  assert.equal(priceEvLabel(140, -137), '-EV')
})

test('Power -137 uses the same direction', () => {
  assert.equal(priceColor(-140, -137), PRICE_GREEN)
  assert.equal(priceColor(-130, -137), PRICE_RED)
})

test('hit-rate color anchors stay put outside 30 and 70', () => {
  assert.deepEqual(hitRateRgb(30), HIT_RED)
  assert.deepEqual(hitRateRgb(50), HIT_NEUTRAL)
  assert.deepEqual(hitRateRgb(70), HIT_GREEN)
  assert.deepEqual(hitRateRgb(10), HIT_RED)
  assert.deepEqual(hitRateRgb(90), HIT_GREEN)
  assert.equal(hitRateColor(30), `rgb(${HIT_RED.join(', ')})`)
  assert.equal(hitRateColor(50), `rgb(${HIT_NEUTRAL.join(', ')})`)
  assert.equal(hitRateColor(70), `rgb(${HIT_GREEN.join(', ')})`)
  assert.equal(hitRateColor(null), null)
})

test('hit rate interpolates between the anchors', () => {
  const midLow = hitRateRgb(40)
  const midHigh = hitRateRgb(60)
  assert.ok(midLow[0] < HIT_RED[0] && midLow[0] > HIT_NEUTRAL[0])
  assert.ok(midHigh[1] > HIT_NEUTRAL[1] && midHigh[1] < HIT_GREEN[1])
  assert.notDeepEqual(midLow, HIT_RED)
  assert.notDeepEqual(midHigh, HIT_GREEN)
})

test('the highlighted book is the best price on the PrizePicks side', () => {
  const books = [
    { book: 'DraftKings', over: -140, under: -150 },
    { book: 'FanDuel', over: -115, under: -130 },
    { book: 'Fanatics', over: 140, under: null },
  ]
  assert.equal(bestAmerican(books, 'over'), 140)
  assert.equal(bestAmerican(books, 'under'), -130)
})

test('a missing edge stays empty instead of becoming zero', () => {
  assert.equal(finiteNumber(null), null)
  assert.equal(finiteNumber(''), null)
  assert.equal(finiteNumber('nope'), null)
  assert.equal(finiteNumber(0), 0)
  assert.equal(finiteNumber(-2.3), -2.3)
})

test('matchup grades stay on the existing DVP scale', () => {
  assert.equal(dvpGrade(32), 'A+')
  assert.equal(dvpGrade(25), 'A')
  assert.equal(dvpGrade(16), 'B')
  assert.equal(dvpGrade(1), 'D')
  assert.equal(dvpGrade(null), null)
  assert.equal(dvpGrade(0), null)
})

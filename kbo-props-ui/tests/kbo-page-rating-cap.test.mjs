import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import { capKboRating, compareKboRating, isNeutralKboRating, kboRating, kboRatingClass, kboRawRating, scoreFor } from '../src/kboBoardScore.js'
import { cgSide } from '../src/cgScore.js'

test('a raw KBO rating over 100 displays as 100 (Park TB O0.5 = 131.6 raw)', () => {
  assert.equal(Number(kboRawRating(1.316, 0.5, 'Total Bases').toFixed(1)), 131.6)
  assert.equal(kboRating(1.316, 0.5, 'Total Bases'), 100)
  assert.equal(kboRating(1.316, 0.5, 'Total Bases'), scoreFor({ stat: 'Total Bases', line: 0.5, projection: 1.316 }))
  assert.equal(capKboRating(131.6), 100)
})

test('a raw KBO rating under 0 displays as 0', () => {
  assert.ok(kboRawRating(-0.4, 1.5, 'Hits+Runs+RBIs') < 0)
  assert.equal(kboRating(-0.4, 1.5, 'Hits+Runs+RBIs'), 0)
  assert.equal(capKboRating(-12), 0)
})

test('in-range ratings are unchanged (same formula, 1 decimal)', () => {
  assert.equal(kboRating(7.1, 5.5, 'Strikeouts'), Number(((7.1 / 5.5) * 50).toFixed(1)))
  assert.equal(kboRating(null, 5.5), null)
  assert.equal(kboRating(5, 0), null)
  assert.equal(capKboRating(null), null)
})

test('exactly 50 is neutral: no side and no side color', () => {
  const rating = kboRating(1.5, 1.5, 'Total Bases')
  assert.equal(rating, 50)
  assert.equal(isNeutralKboRating(rating, kboRawRating(1.5, 1.5)), true)
  assert.equal(kboRatingClass(rating, 50), 'rate-neutral')
  assert.equal(cgSide(rating), null)
  // 49.97 raw rounds to 50.0 but is not on the line: keeps its color
  assert.notEqual(kboRatingClass(50, 49.97), 'rate-neutral')
  assert.equal(kboRatingClass(80, 80), 'rate-high')
  assert.equal(kboRatingClass(null, null), '')
})

test('ties at 100 break on the raw score, both directions', () => {
  const rows = [
    { name: 'A', rating: 100, rawRating: 104 },
    { name: 'B', rating: 100, rawRating: 131.6 },
    { name: 'C', rating: 80, rawRating: 80 },
  ]
  assert.deepEqual([...rows].sort((a, b) => compareKboRating(a, b, 'desc')).map((r) => r.name), ['B', 'A', 'C'])
  assert.deepEqual([...rows].sort((a, b) => compareKboRating(a, b, 'asc')).map((r) => r.name), ['C', 'A', 'B'])
})

test('Batter and Strikeout pages no longer recompute an uncapped rating', () => {
  for (const f of ['BatterProjections.jsx', 'StrikeoutProjections.jsx']) {
    const src = fs.readFileSync(new URL(`../src/${f}`, import.meta.url), 'utf8')
    assert.ok(!/\* 50\)\.toFixed/.test(src), `${f} still has the inline formula`)
    assert.match(src, /kboRating\(projection, liveLine, p\.prop\)/)
    assert.match(src, /compareKboRating\(a, b,/)
    assert.match(src, /kboRatingClass\(p\.rating, p\.rawRating\)/)
  }
})

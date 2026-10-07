import assert from 'node:assert/strict'
import test from 'node:test'
import {
  batterProfile,
  battingHand,
  battingHandPhrase,
  propSplit,
  resolveBattingHand,
  seasonSplit,
  starterHandKey,
  withStarterHands,
} from '../src/batterSplits.js'

test('batting hand uses the same L/R/S letters as the batter board', () => {
  assert.equal(battingHand('Left'), 'L')
  assert.equal(battingHand('switch'), 'S')
  assert.equal(battingHand('UNK'), null)
  assert.equal(battingHandPhrase('L'), 'Bats L')
  assert.equal(battingHandPhrase(null), null)
})

test('starter hands attach from the date and opponent, and never invent a side', () => {
  const games = [
    { date: '2026-04-01', opp: 'Samsung', season: '2026', hrr: 4 },
    { date: '04/02/2026', opp: 'KIA', season: '2026', hrr: 1, opp_hand: 'LHP' },
    { date: '2026-04-03', opp: 'KT', season: '2026', hrr: 3 },
  ]
  const tagged = withStarterHands(games, { '2026-04-01|Samsung': 'R' })
  assert.equal(starterHandKey('04/01/2026', 'SAM'), '2026-04-01|Samsung')
  assert.deepEqual(tagged.map((game) => game.opp_hand), ['R', 'L', null])
})

test('prop hit rate follows the selected line and skips games with no starter hand', () => {
  const games = [
    { season: '2026', opp_hand: 'L', hrr: 4 },
    { season: '2026', opp_hand: 'L', hrr: 1 },
    { season: '2026', opp_hand: 'R', hrr: 3 },
    { season: '2026', opp_hand: null, hrr: 9 },
    { season: '2025', opp_hand: 'L', hrr: 8 },
  ]
  const value = (game) => game.hrr
  const left = propSplit(games, value, 2.5, 'L', '2026')
  assert.deepEqual(left, { pct: 50, hits: 1, games: 2, avg: 2.5 })
  const right = propSplit(games, value, 2.5, 'R', '2026')
  assert.equal(right.pct, 100)
  assert.equal(right.games, 1)
  const missing = propSplit([{ season: '2026', opp_hand: null, hrr: 4 }], value, 2.5, 'L', '2026')
  assert.equal(missing.pct, null)
  assert.equal(missing.games, 0)
})

test('season split prefers the official file and does not invent a number', () => {
  const profile = { vs_lhp: { avg: 0.375, ab: 16, tb: 7 }, vs_rhp: null }
  assert.equal(seasonSplit(profile, { vs_lhp_avg: 0.1, vs_lhp_ab: 4 }, 'L').avg, 0.375)
  assert.equal(seasonSplit(null, { vs_rhp_avg: 0.222, vs_rhp_ab: 36 }, 'R').ab, 36)
  assert.equal(seasonSplit({ vs_lhp: { avg: 0, ab: 0 } }, { vs_lhp_avg: null, vs_lhp_ab: null }, 'L'), null)
})

test('batting hand falls through card, profile, then projection', () => {
  const context = { batters: { 'choi jun won': { name: 'Choi Won-jun', hand: 'L' } } }
  assert.equal(batterProfile(context, 'Won-jun Choi').hand, 'L')
  assert.equal(resolveBattingHand({ batting_hand: 'R' }, { hand: 'L' }, null), 'R')
  assert.equal(resolveBattingHand({}, null, { batter_hand: 'S' }), 'S')
  assert.equal(resolveBattingHand({ batting_hand: 'UNK' }, null, null), null)
})

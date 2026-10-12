import assert from 'node:assert/strict'
import test from 'node:test'
import {
  HOT_L10_GAMES,
  HOT_L10_RATE,
  buildSlate,
  formatSlateDate,
  hotStreakRows,
  propsOnBoardCount,
  slateDateLabel,
  sortWnbaRows,
} from '../src/wnbaBoard.js'

const row = (player, rate, games, score, extra = {}) => ({
  player,
  score,
  team: extra.team || 'ATL',
  opponent: extra.opponent || 'GSV',
  gameDate: extra.gameDate,
  dvpRank: extra.dvpRank,
  hitPills: rate == null ? [] : [{ id: 'l10', label: 'L10', rate, games }],
})

test('L10 sort follows the pill and puts a missing pill last', () => {
  const sorted = sortWnbaRows([
    row('Howard', 50, 8, 52),
    row('Gray', 63, 8, 51.9),
    row('Other', null, 0, 80),
    row('Low', 38, 8, 50.4),
  ], 'L10 Hit Rate', '2026')
  assert.deepEqual(sorted.map((item) => item.player), ['Gray', 'Howard', 'Low', 'Other'])
})

test('hottest streaks require 60% over at least 5 decided games', () => {
  assert.equal(HOT_L10_RATE, 60)
  assert.equal(HOT_L10_GAMES, 5)
  const kept = hotStreakRows([
    row('Coin', 50, 10, 40),
    row('Short', 80, 4, 70),
    row('Hot', 63, 8, 51),
    row('Hotter', 70, 6, 49),
  ])
  assert.deepEqual(kept.map((item) => item.player), ['Hotter', 'Hot'])
})

test('props on board include the locked rows', () => {
  assert.equal(propsOnBoardCount(3, 60), 63)
  assert.equal(propsOnBoardCount(3, 0), 3)
})

test('a future Finals slate is not labeled today', () => {
  const now = new Date('2026-10-11T20:00:00Z')
  const slate = buildSlate([
    row('Gray', 63, 8, 51, { team: 'ATL', opponent: 'GSV', gameDate: '2026-10-17' }),
    row('Howard', 50, 8, 52, { team: 'GSV', opponent: 'ATL', gameDate: '2026-10-17' }),
  ], now)
  assert.equal(slate.gameDate, '2026-10-17')
  assert.equal(slate.isToday, false)
  assert.equal(slate.title, 'Sat, Oct 17')
  assert.equal(slate.kicker, 'Next slate · 1 matchup')
  assert.equal(formatSlateDate('2026-10-17'), 'Sat, Oct 17')
  assert.equal(slateDateLabel('2026-10-17', now), 'Sat, Oct 17')
  assert.equal(slateDateLabel('2026-10-11', now), "Today's slate")

  const today = buildSlate([
    row('Gray', 63, 8, 51, { team: 'ATL', opponent: 'GSV', gameDate: '2026-10-11' }),
  ], now)
  assert.equal(today.title, "Today's Slate")
  assert.equal(today.kicker, '1 matchup')
})

import assert from 'node:assert/strict'
import test from 'node:test'
import { kboHitPills } from '../src/hitRateStrip.js'
import {
  BREAKEVEN_AS_OF,
  MIN_SAMPLE_GAMES,
  PRIZEPICKS_LINEUPS,
  breakevenFor,
  formatBreakEvenRate,
  kboBreakEvenWindows,
} from '../src/prizepicksBreakeven.js'

const PUBLISHED = [
  ['power', 2, '3x', 57.74],
  ['power', 3, '6x', 55.03],
  ['power', 4, '10x', 56.23],
  ['power', 5, '20x', 54.93],
  ['power', 6, '37.5x', 54.66],
  ['flex', 2, '2x / 0.5x', 61.80],
  ['flex', 3, '3x / 1x', 57.74],
  ['flex', 4, '6x / 1.5x', 55.03],
  ['flex', 5, '10x / 2x / 0.4x', 54.25],
  ['flex', 6, '25x / 2x / 0.4x', 54.21],
]

test('standard Power and Flex break-evens match the PrizePicks payout table', () => {
  assert.equal(BREAKEVEN_AS_OF, 'Oct 11, 2026')
  assert.equal(PRIZEPICKS_LINEUPS.length, 10)
  assert.equal(MIN_SAMPLE_GAMES, 5)
  for (const [mode, picks, payout, rate] of PUBLISHED) {
    const row = breakevenFor(mode, picks)
    assert.equal(row.payout, payout)
    assert.equal(row.rate, rate)
    assert.equal(formatBreakEvenRate(rate), `${rate.toFixed(2)}%`)
  }
  assert.equal(breakevenFor('power', 7), null)
  assert.equal(breakevenFor('demon', 2), null)
})

function gamesFrom(values, { season = '2026', opp = 'LG', stat = 'hrr' } = {}) {
  return values.map((value, index) => ({
    season: index < 8 ? season : '2025',
    opp,
    [stat]: value,
  }))
}

test('over windows match the board L10 and season pills, and a 4-game sample is hidden', () => {
  const values = [3, 0, 2, 4, 1, 0, 3, 2, 5, 0, 1, 4]
  const games = values.map((hrr, index) => ({ season: '2026', opp: 'LG', hrr }))
  const line = 1.5
  const pills = kboHitPills({ games, stat: 'Hits+Runs+RBIs', line, opponent: 'Kia' })
  const windows = kboBreakEvenWindows({ games, stat: 'Hits+Runs+RBIs', line, side: 'over' })
  const byPill = Object.fromEntries(pills.map((pill) => [pill.id, pill]))
  const byWindow = Object.fromEntries(windows.map((window) => [window.id, window]))
  assert.equal(byWindow.l10.rate, byPill.l10.rate)
  assert.equal(byWindow.l10.games, byPill.l10.games)
  assert.equal(byWindow.season.rate, byPill.season.rate)
  assert.equal(byWindow.season.games, byPill.season.games)
  assert.ok(byWindow.l10.games >= 5)
  assert.ok(byWindow.l10.hits <= byWindow.l10.games)

  const short = kboBreakEvenWindows({
    games: games.slice(0, 4),
    stat: 'Hits+Runs+RBIs',
    line,
    side: 'over',
  })
  assert.deepEqual(short, [])
})

test('L10 waits for 10 logged games, and five decided season games is enough', () => {
  const games = [3, 0, 2, 4, 1, 0].map((hrr) => ({ season: '2026', opp: 'KT', hrr }))
  const windows = kboBreakEvenWindows({ games, stat: 'Hits+Runs+RBIs', line: 1.5, side: 'over' })
  assert.deepEqual(windows.map((window) => window.id), ['season'])
  assert.equal(windows[0].games, 6)

  const five = [3, 0, 2, 4, 1].map((hrr) => ({ season: '2026', opp: 'KT', hrr }))
  const fiveWindows = kboBreakEvenWindows({ games: five, stat: 'Hits+Runs+RBIs', line: 1.5, side: 'over' })
  assert.deepEqual(fiveWindows.map((window) => window.id), ['season'])
  assert.equal(fiveWindows[0].games, 5)

  const four = [3, 0, 2, 4].map((hrr) => ({ season: '2026', opp: 'KT', hrr }))
  assert.deepEqual(kboBreakEvenWindows({ games: four, stat: 'Hits+Runs+RBIs', line: 1.5 }), [])
})

test('a push leaves the count, and an under grades the other side of the same games', () => {
  const games = gamesFrom([3, 1.5, 0, 2, 0, 4, 1, 2, 0, 3])
  const over = kboBreakEvenWindows({ games, stat: 'Hits+Runs+RBIs', line: 1.5, side: 'over' })
  const under = kboBreakEvenWindows({ games, stat: 'Hits+Runs+RBIs', line: 1.5, side: 'under' })
  const overL10 = over.find((window) => window.id === 'l10')
  const underL10 = under.find((window) => window.id === 'l10')
  assert.equal(overL10.games, 9)
  assert.equal(overL10.hits, 5)
  assert.equal(overL10.rate, 56)
  assert.equal(underL10.games, 9)
  assert.equal(underL10.hits, 4)
  assert.equal(underL10.rate, 44)
  assert.equal(over.find((window) => window.id === 'season').games < 10, true)
})

test('fewer than 5 decided games hides the window even when 10 games are logged', () => {
  const games = [1.5, 1.5, 1.5, 1.5, 1.5, 1.5, 3, 0, 1.5, 1.5].map((hrr) => ({
    season: '2026', opp: 'LG', hrr,
  }))
  const windows = kboBreakEvenWindows({ games, stat: 'Hits+Runs+RBIs', line: 1.5, side: 'over' })
  assert.deepEqual(windows, [])
})

test('an unknown stat or a missing line produces no meter windows', () => {
  const games = Array.from({ length: 10 }, () => ({ season: '2026', opp: 'LG', hrr: 2 }))
  assert.deepEqual(kboBreakEvenWindows({ games, stat: 'Hits', line: 1.5 }), [])
  assert.deepEqual(kboBreakEvenWindows({ games, stat: 'Hits+Runs+RBIs', line: null }), [])
  assert.deepEqual(kboBreakEvenWindows({ games: [], stat: 'Hits+Runs+RBIs', line: 1.5 }), [])
})

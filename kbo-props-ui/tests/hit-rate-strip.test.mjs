import assert from 'node:assert/strict'
import test from 'node:test'
import { buildPropRows } from '../src/nba/nbaPropLines.js'
import {
  HIT_RATE_AMBER,
  HIT_RATE_GREEN,
  HIT_RATE_LIGHT,
  HIT_RATE_RED,
  fixedWindowPill,
  formatHitRate,
  hitRatePillColor,
  kboHitPills,
  nflHitPills,
  nhlHitPills,
  overHitRate,
  wnbaHitPills,
} from '../src/hitRateStrip.js'

test('hit-rate colors follow the 70 / 55 / 45 thresholds', () => {
  assert.equal(hitRatePillColor(100), HIT_RATE_GREEN)
  assert.equal(hitRatePillColor(70), HIT_RATE_GREEN)
  assert.equal(hitRatePillColor(69.9), HIT_RATE_LIGHT)
  assert.equal(hitRatePillColor(55), HIT_RATE_LIGHT)
  assert.equal(hitRatePillColor(54.9), HIT_RATE_AMBER)
  assert.equal(hitRatePillColor(45), HIT_RATE_AMBER)
  assert.equal(hitRatePillColor(44.9), HIT_RATE_RED)
  assert.equal(hitRatePillColor(0), HIT_RATE_RED)
  assert.equal(hitRatePillColor(null), null)
  assert.equal(hitRatePillColor('nope'), null)
})

test('format keeps a tenth only when the chart rate is not a whole number', () => {
  assert.equal(formatHitRate(80), '80%')
  assert.equal(formatHitRate(13.9), '13.9%')
  assert.equal(formatHitRate(50.04), '50%')
})

test('strict over leaves a push in the sample and does not count it', () => {
  const rated = overHitRate([2, 1.5, 1], 1.5, 'strict')
  assert.deepEqual(rated, { rate: 33, hits: 1, games: 3 })
})

test('NFL push counts as a hit', () => {
  const rated = overHitRate([2, 1.5, 1], 1.5, 'count-push')
  assert.deepEqual(rated, { rate: 67, hits: 2, games: 3 })
})

test('NHL push is left out of the sample', () => {
  const rated = overHitRate([2, 1.5, 1], 1.5, 'exclude-push')
  assert.deepEqual(rated, { rate: 50, hits: 1, games: 2 })
  assert.equal(overHitRate([1.5, 1.5], 1.5, 'exclude-push'), null)
})

test('a short window is hidden unless the chart already shows a count', () => {
  const four = [1, 1, 1, 1]
  assert.equal(fixedWindowPill(four, 0.5, { id: 'l5', label: 'L5', size: 5 }), null)
  const partial = fixedWindowPill(four, 0.5, { id: 'l5', label: 'L5', size: 5, partial: 'count' })
  assert.equal(partial.rate, 100)
  assert.equal(partial.count, 4)
  const full = fixedWindowPill([1, 1, 1, 1, 0], 0.5, { id: 'l5', label: 'L5', size: 5, partial: 'count' })
  assert.equal(full.count, null)
  assert.equal(full.rate, 80)
})

test('KBO pills use the player-page log, current season, and exact opponent', () => {
  const games = [
    { season: '2026', opp: 'Kia', hrr: 3, tb: 4 },
    { season: '2026', opp: 'KT', hrr: 1, tb: 1 },
    { season: '2026', opp: 'Kia', hrr: 2, tb: 2 },
    { season: '2026', opp: 'LG', hrr: 0, tb: 0 },
    { season: '2026', opp: 'Kia', hrr: 2, tb: 5 },
    { season: '2025', opp: 'Kia', hrr: 0, tb: 0 },
  ]
  const pills = kboHitPills({ games, stat: 'Hits+Runs+RBIs', line: 1.5, opponent: 'Kia' })
  const byId = Object.fromEntries(pills.map((pill) => [pill.id, pill]))
  assert.equal(byId.l5.rate, 60)
  assert.equal(byId.l5.count, null)
  assert.equal(byId.l10, undefined)
  assert.equal(byId.l20, undefined)
  assert.equal(byId.h2h.rate, 75)
  assert.equal(byId.h2h.games, 4)
  assert.equal(byId.season.games, 5)
  assert.equal(byId.season.rate, 60)
  assert.deepEqual(pills.map((pill) => pill.id), ['l5', 'h2h', 'season'])
})

test('KBO hides H2H when the log has no games against today opponent', () => {
  const games = Array.from({ length: 5 }, () => ({ season: '2026', opp: 'LG', so: 6 }))
  const pills = kboHitPills({ games, stat: 'Pitcher Strikeouts', line: 5.5, opponent: 'Kia' })
  assert.equal(pills.find((pill) => pill.id === 'h2h'), undefined)
  assert.equal(pills.find((pill) => pill.id === 'l5').rate, 100)
})

test('WNBA season is the newest game year and H2H is that opponent only', () => {
  const games = [
    { date: '10/08/2026', opponent: 'NY', pts: 22 },
    { date: '10/06/2026', opponent: 'LV', pts: 10 },
    { date: '2026-10-04T00:00:00', opponent: 'NY', pts: 30 },
    { date: '10/02/2026', opponent: 'CHI', pts: 18 },
    { date: '09/30/2026', opponent: 'NY', pts: 12 },
    { date: '09/01/2025', opponent: 'NY', pts: 40 },
  ]
  const pills = wnbaHitPills({ games, stat: 'Points', line: 19.5, opponent: 'ny' })
  const byId = Object.fromEntries(pills.map((pill) => [pill.id, pill]))
  assert.equal(byId.l5.rate, 40)
  assert.equal(byId.season.games, 5)
  assert.equal(byId.season.rate, 40)
  assert.equal(byId.h2h.games, 4)
  assert.equal(byId.h2h.rate, 75)
})

test('NFL pills use the shipped chart rates and hide a short window', () => {
  const pills = nflHitPills({
    hitRateL5: 80,
    gamesL5: 5,
    hitRate: 60,
    gamesPlayed: 6,
    hitRateL20: 55,
    gamesL20: 12,
    h2hHitRate: 0,
    h2hGames: 2,
    seasonHitRate: 45,
    seasonGames: 5,
  })
  const byId = Object.fromEntries(pills.map((pill) => [pill.id, pill]))
  assert.equal(byId.l5.rate, 80)
  assert.equal(byId.l10, undefined)
  assert.equal(byId.l20, undefined)
  assert.equal(byId.h2h.rate, 0)
  assert.equal(hitRatePillColor(byId.h2h.rate), HIT_RATE_RED)
  assert.equal(byId.season.rate, 45)
  assert.equal(hitRatePillColor(byId.season.rate), HIT_RATE_AMBER)
})

test('NHL short windows keep the chart game count', () => {
  const pills = nhlHitPills({
    hitRateL5: 33.3,
    gamesL5: 3,
    hitRate: 40,
    gamesL10: 10,
    hitRateL20: null,
    gamesL20: 0,
    h2hHitRate: null,
    h2hGames: 0,
    seasonHitRate: 13.9,
    seasonGames: 8,
  })
  const byId = Object.fromEntries(pills.map((pill) => [pill.id, pill]))
  assert.equal(byId.l5.count, 3)
  assert.equal(byId.l5.rate, 33.3)
  assert.equal(byId.l10.count, null)
  assert.equal(byId.l20, undefined)
  assert.equal(byId.h2h, undefined)
  const withPrior = nhlHitPills({
    hitRateL5: 80,
    gamesL5: 5,
    hitRate: 70,
    gamesL10: 10,
    hitRateL20: 60,
    gamesL20: 20,
    h2hHitRate: 50,
    h2hGames: 4,
    h2hIncludesPriorSeason: true,
    seasonHitRate: 13.9,
    seasonGames: 8,
  })
  assert.equal(withPrior.find((pill) => pill.id === 'h2h').note, 'includes 2025-26')
  assert.equal(formatHitRate(byId.season.rate), '13.9%')
  assert.equal(hitRatePillColor(byId.season.rate), HIT_RATE_RED)
})

test('NBA board pills follow the log and skip a short window', () => {
  const games = [
    { pts: 30, reb: 4, ast: 3, fg3m: 1, stl: 1, blk: 0, tov: 2, matchup: 'ATL vs. BOS' },
    { pts: 10, reb: 4, ast: 3, fg3m: 1, stl: 1, blk: 0, tov: 2, matchup: 'ATL @ BOS' },
    { pts: 25, reb: 4, ast: 3, fg3m: 1, stl: 1, blk: 0, tov: 2, matchup: 'ATL vs. BOS' },
    { pts: 22, reb: 4, ast: 3, fg3m: 1, stl: 1, blk: 0, tov: 2, matchup: 'ATL @ NY' },
    { pts: 28, reb: 4, ast: 3, fg3m: 1, stl: 1, blk: 0, tov: 2, matchup: 'ATL vs. BOS' },
    { pts: 18, reb: 4, ast: 3, fg3m: 1, stl: 1, blk: 0, tov: 2, matchup: 'ATL @ MIA' },
  ]
  const rows = buildPropRows([{
    athleteId: '1',
    name: 'Trae Young',
    team: 'ATL',
    ppAllProps: [{ stat: 'Points', line: 20.5, standardLine: 20.5, projection: 24, opponent: 'BOS' }],
  }], [{
    athleteId: '1',
    name: 'Trae Young',
    gameLogs: games,
  }])
  const byId = Object.fromEntries(rows[0].hitPills.map((pill) => [pill.id, pill]))
  assert.equal(byId.l5.rate, 80)
  assert.equal(byId.l10, undefined)
  assert.equal(byId.l20, undefined)
  assert.equal(byId.h2h.games, 4)
  assert.equal(byId.h2h.rate, 75)
  assert.equal(byId.season.games, 6)
  assert.equal(byId.season.rate, 67)
})

test('NBA falls back to the saved last-10 series and still hides H2H', () => {
  const rows = buildPropRows([{
    athleteId: '2',
    name: 'Tester',
    team: 'BOS',
    ppAllProps: [{
      stat: 'Offensive Rebounds',
      line: 1.5,
      projection: 2,
      opponent: 'NY',
      l10Values: [3, 0, 2, 2, 0, 4, 1, 2, 0, 3],
    }],
  }], [])
  assert.deepEqual(rows[0].hitPills.map((pill) => pill.id), ['l5', 'l10'])
  assert.equal(rows[0].hitPills[0].rate, 60)
  assert.equal(rows[0].hitPills[1].rate, 60)
})

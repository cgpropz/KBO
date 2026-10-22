import assert from 'node:assert/strict'
import test from 'node:test'
import { buildPropRows } from '../src/nba/nbaPropLines.js'
import {
  HIT_RATE_AMBER,
  HIT_RATE_GREEN,
  HIT_RATE_LIGHT,
  HIT_RATE_NEUTRAL_BG,
  HIT_RATE_NEUTRAL_TEXT,
  HIT_RATE_RED,
  fixedWindowPill,
  formatGameCount,
  formatHitRate,
  hitRateFill,
  hitRatePillColor,
  hitRatePillStyle,
  kboHitPills,
  l10Display,
  barResult,
  chartWindowRate,
  lineResult,
  nflHitPills,
  nhlHitPills,
  nhlWindowPushes,
  openPill,
  storedPill,
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

test('tinted pills use the threshold color for text and wash it into the fill', () => {
  const tone = hitRatePillStyle({ rate: 60, games: 10 })
  assert.equal(tone.thin, false)
  assert.equal(tone.color, HIT_RATE_LIGHT)
  assert.equal(tone.background, hitRateFill(HIT_RATE_LIGHT, 0.16))
  assert.equal(tone.borderColor, hitRateFill(HIT_RATE_LIGHT, 0.45))
  assert.equal(hitRatePillStyle({ rate: 80, games: 5 }).color, HIT_RATE_GREEN)
  assert.equal(hitRatePillStyle({ rate: 45, games: 8 }).color, HIT_RATE_AMBER)
  assert.equal(hitRatePillStyle({ rate: 20, games: 6 }).color, HIT_RATE_RED)
  assert.equal(hitRatePillStyle({ rate: null, games: 6 }), null)
})

test('a sample under 3 games is neutral instead of a hit-rate color', () => {
  const tone = hitRatePillStyle({ rate: 100, games: 2 })
  assert.equal(tone.thin, true)
  assert.equal(tone.background, HIT_RATE_NEUTRAL_BG)
  assert.equal(tone.color, HIT_RATE_NEUTRAL_TEXT)
  assert.equal(tone.color === HIT_RATE_GREEN, false)
  assert.equal(formatGameCount(2), '2 gm')
  assert.equal(formatGameCount(0), '')
  assert.equal(hitRatePillStyle({ rate: 40, games: 3 }).thin, false)
})

test('format rounds the chart rate to a whole number', () => {
  assert.equal(formatHitRate(80), '80%')
  assert.equal(formatHitRate(13.9), '14%')
  assert.equal(formatHitRate(33.3), '33%')
  assert.equal(formatHitRate(50.04), '50%')
})

test('the chart bar and the L10 rate share one count, including a string line', () => {
  assert.equal(barResult('22', '15.5', 'OVER'), 'hit')
  assert.equal(barResult(15.5, '15.5', 'OVER'), 'push')
  assert.equal(barResult('3', 15.5, 'OVER'), 'miss')
  assert.equal(barResult(3, 15.5, 'UNDER'), 'hit')
  assert.equal(barResult('nope', 15.5, 'OVER'), null)
  const window = ['22', 15.5, '40', 3, '18', 30, '12', 16, 9, '28']
  assert.deepEqual(chartWindowRate(window, '15.5', 'OVER'), { rate: 67, hits: 6, games: 9, pushes: 1 })
  assert.deepEqual(chartWindowRate(window, 15.5, 'UNDER'), { rate: 33, hits: 3, games: 9, pushes: 1 })
  assert.equal(chartWindowRate([15.5, '15.5'], 15.5, 'OVER'), null)
})

test('a push is neither a hit nor a miss and leaves the sample', () => {
  assert.equal(lineResult(2, 1.5), 'hit')
  assert.equal(lineResult(1.5, 1.5), 'push')
  assert.equal(lineResult(1, 1.5), 'miss')
  assert.equal(lineResult(null, 1.5), null)
  const rated = overHitRate([2, 1.5, 1], 1.5)
  assert.deepEqual(rated, { rate: 50, hits: 1, games: 2, pushes: 1 })
  assert.equal(overHitRate([1.5, 1.5], 1.5), null)
  assert.equal(formatGameCount(rated.games), '2 gm')
  assert.equal(formatGameCount(rated.games, rated.pushes), '2 decided · 1 push')
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

test('NFL pills are recomputed from the log and a push is not a hit', () => {
  // Oldest-first, same order as the shipped chart. Stored >= rates would call
  // the two ties hits (L5 80%). The pill uses the decided games only.
  const pills = nflHitPills({
    line: 1.5,
    opponent: 'MIA',
    priorSeasonLabel: 2025,
    recent: [0, 0, 1.5, 0, 1.5, 2],
    gameSeasons: [2025, 2025, 2025, 2026, 2026, 2026],
    gameOpponents: ['BUF', 'MIA', 'NYJ', 'MIA', 'MIA', 'CIN'],
    hitRateL5: 80,
    gamesL5: 5,
    hitRate: 60,
    gamesPlayed: 6,
  })
  const byId = Object.fromEntries(pills.map((pill) => [pill.id, pill]))
  assert.equal(byId.l5.rate, 33)
  assert.equal(byId.l5.games, 3)
  assert.equal(byId.l10, undefined)
  assert.equal(byId.l20, undefined)
  assert.equal(byId.h2h.rate, 0)
  assert.equal(byId.h2h.games, 2)
  assert.equal(hitRatePillStyle(byId.h2h).thin, true)
  assert.equal(hitRatePillStyle(byId.h2h).background, HIT_RATE_NEUTRAL_BG)
  assert.equal(byId.season.rate, 50)
  assert.equal(byId.season.games, 2)
})

test('a push drops out of a KBO pill count', () => {
  const games = [
    { season: '2026', opp: 'Kia', hrr: 3 },
    { season: '2026', opp: 'KT', hrr: 1.5 },
    { season: '2026', opp: 'Kia', hrr: 2 },
    { season: '2026', opp: 'LG', hrr: 0 },
    { season: '2026', opp: 'Kia', hrr: 2 },
  ]
  const pills = kboHitPills({ games, stat: 'Hits+Runs+RBIs', line: 1.5, opponent: 'Samsung' })
  const l5 = pills.find((pill) => pill.id === 'l5')
  assert.equal(l5.rate, 75)
  assert.equal(l5.games, 4)
  assert.equal(pills.find((pill) => pill.id === 'h2h'), undefined)
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
  assert.equal(formatHitRate(byId.season.rate), '14%')
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

test('homepage L10 uses the board pill and leaves pushes out', () => {
  const games = [
    { season: '2026', opp: 'Kia', tb: 3 },
    { season: '2026', opp: 'KT', tb: 2 },
    { season: '2026', opp: 'LG', tb: 1 },
    { season: '2026', opp: 'Kia', tb: 4 },
    { season: '2026', opp: 'NC', tb: 2 },
    { season: '2026', opp: 'SSG', tb: 0 },
    { season: '2026', opp: 'Kia', tb: 5 },
    { season: '2026', opp: 'Doosan', tb: 2 },
    { season: '2026', opp: 'KT', tb: 1 },
    { season: '2026', opp: 'LG', tb: 0 },
  ]
  const pills = kboHitPills({ games, stat: 'Total Bases', line: 2, opponent: 'Samsung' })
  const shown = l10Display(pills)
  assert.equal(shown.text, '43%')
  // A whole-number line: three games tied 2, so the count names them.
  assert.equal(shown.games, '7 decided · 3 push')
  assert.equal(shown.decided, 7)
})

test('the count names pushes and keeps the bare count when there are none', () => {
  assert.equal(formatGameCount(3, 4), '3 decided · 4 push')
  assert.equal(formatGameCount(3, 0), '3 gm')
  assert.equal(formatGameCount(3), '3 gm')
  assert.equal(formatGameCount(3, null), '3 gm')
  assert.equal(formatGameCount(0, 4), '')
})

test('pushes never change the rate or the decided count', () => {
  const whole = overHitRate([3, 2, 2, 2, 3, 0, 2], 2)
  assert.deepEqual(whole, { rate: 67, hits: 2, games: 3, pushes: 4 })
  const half = overHitRate([3, 2, 2, 2, 3, 0, 2], 2.5)
  assert.deepEqual(half, { rate: 29, hits: 2, games: 7, pushes: 0 })
  const pill = openPill([3, 2, 2, 2, 3, 0, 2], 2, { id: 'season', label: 'Season' })
  assert.equal(pill.rate, 67)
  assert.equal(pill.games, 3)
  assert.equal(pill.pushes, 4)
  const stored = storedPill({ id: 'season', label: 'Season', rate: 66.7, games: 3, pushes: 4 })
  assert.equal(stored.rate, 66.7)
  assert.equal(stored.games, 3)
  assert.equal(stored.pushes, 4)
  assert.equal(storedPill({ id: 'season', label: 'Season', rate: 66.7, games: 3 }).pushes, 0)
})

// Made-up NHL row: 3 prior-season games, then 7 this season, oldest-first.
const NHL_WHOLE_LINE = {
  line: 2,
  opponent: 'BOS',
  log: [5, 3, 2, 2, 0, 3, 2, 2, 2, 3],
  logSeasons: ['2025-26', '2025-26', '2025-26', '2026-27', '2026-27', '2026-27', '2026-27', '2026-27', '2026-27', '2026-27'],
  logOpponents: ['BOS', 'NYR', 'TOR', 'BOS', 'MTL', 'NYR', 'TOR', 'BOS', 'MTL', 'NYR'],
  hitRateL5: 50,
  gamesL5: 2,
  hitRate: 80,
  gamesL10: 5,
  hitRateL20: null,
  gamesL20: 0,
  h2hHitRate: 100,
  h2hGames: 1,
  seasonHitRate: 66.7,
  seasonGames: 3,
}

test('NHL pills on a whole-number line say how many games pushed', () => {
  const pills = nhlHitPills(NHL_WHOLE_LINE)
  const byId = Object.fromEntries(pills.map((pill) => [pill.id, pill]))
  assert.equal(byId.season.games, 3)
  assert.equal(byId.season.rate, 66.7)
  assert.equal(byId.season.pushes, 4)
  assert.equal(formatGameCount(byId.season.games, byId.season.pushes), '3 decided · 4 push')
  assert.equal(byId.l5.pushes, 3)
  assert.equal(byId.l10.pushes, 5)
  assert.equal(byId.h2h.pushes, 2)
  assert.equal(l10Display(pills).games, '5 decided · 5 push')
})

test('NHL push note is skipped when the log does not cover the stored count', () => {
  assert.equal(nhlWindowPushes({ ...NHL_WHOLE_LINE, seasonGames: 5 }, 'season', 5), 0)
  assert.equal(nhlWindowPushes({ ...NHL_WHOLE_LINE, log: [] }, 'season', 3), 0)
  assert.equal(nhlWindowPushes({ ...NHL_WHOLE_LINE, line: null }, 'season', 3), 0)
  const noLog = nhlHitPills({ ...NHL_WHOLE_LINE, log: undefined })
  assert.equal(formatGameCount(noLog.find((pill) => pill.id === 'season').games, 0), '3 gm')
})

test('NHL half-point lines keep the bare count', () => {
  const half = { ...NHL_WHOLE_LINE, line: 2.5, seasonGames: 7, seasonHitRate: 28.6 }
  const season = nhlHitPills(half).find((pill) => pill.id === 'season')
  assert.equal(season.pushes, 0)
  assert.equal(formatGameCount(season.games, season.pushes), '7 gm')
})

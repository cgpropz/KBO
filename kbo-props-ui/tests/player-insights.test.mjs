// Player-page Splits / Advanced stats math. Made-up game logs only.
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { buildSplits, formatMetric, metricSeries, metricWindows, parseGameDay, seriesDayLabels, seriesLabelsVertical, seriesRange, seriesValueLabel, withRest } from '../src/playerInsights/insightsCore.js'
import { basketballSeasonLabel, EARLY_SEASON_GAMES, kboInsights, nbaInsights, nbaTeamKey, nflInsights, nflTeamKey, nhlInsights, wnbaInsights, wnbaTeamKey } from '../src/playerInsights/insightsSports.js'
import { averageMetric } from '../src/nba/nbaMinutesUsage.js'

test('parses each sport date shape', () => {
  assert.equal(parseGameDay('2026-10-01'), parseGameDay('10/01/2026'))
  assert.equal(parseGameDay('10/1', () => 2026), parseGameDay('2026-10-01'))
  assert.equal(parseGameDay('10/1'), null)
  assert.equal(basketballSeasonLabel('2027'), "'26-27")
})

test('rest days stay inside a season', () => {
  const games = withRest([
    { day: 10, season: 'S2' },
    { day: 9, season: 'S2' },
    { day: 6, season: 'S2' },
    { day: 1, season: 'S1' },
  ])
  assert.deepEqual(games.map((game) => game.rest), [0, 2, null, null])
})

function nbaLog(date, pts, matchup, result, season = '2027') {
  return { date, pts, reb: 5, ast: 3, min: 30, fga: 15, fgm: 7, fg3a: 5, fg3m: 2, fta: 4, ftm: 3, tov: 2, usg: 22, matchup, result, season }
}

test('NBA splits: venue, opponent, result, rest, hit rate vs line, small samples', () => {
  const logs = [
    nbaLog('10/22/2026', 30, 'AAA vs. BBB', 'W'),
    nbaLog('10/21/2026', 10, 'AAA @ CCC', 'L'),
    nbaLog('10/18/2026', 25, 'AAA vs. BBB', 'W'),
    nbaLog('04/10/2026', 20, 'AAA @ BBB', 'L', '2026'),
  ]
  const model = nbaInsights(logs, { valueOf: (game) => game.pts, opponent: 'BBB' })
  assert.equal(model.currentSeason, '2027')
  assert.equal(model.priorSeason, '2026')
  const splits = buildSplits(model.games, { ...model, line: 19.5, today: parseGameDay('10/23/2026') })
  const byId = Object.fromEntries(splits.rows.map((row) => [row.id, row]))
  assert.equal(byId.season.n, 3)
  assert.equal(byId.season.early, true)
  assert.equal(byId.season.rate, 67)
  assert.equal(byId.home.n, 2)
  assert.equal(byId.home.rate, 100)
  assert.equal(byId.away.avg, 15)
  assert.equal(byId.vsopp.n, 3)
  assert.equal(byId.wins.n, 2)
  assert.equal(byId.losses.rate, 50)
  assert.equal(byId.rest0.n, 1)
  assert.equal(byId.rest2.n, 1)
  assert.equal(byId.l30d.n, 3)
  assert.equal(byId.home.small, true)
  assert.deepEqual(splits.skipped, [])
})

test('missing fields are skipped, never shown as zero', () => {
  const model = kboInsights({ type: 'pitcher', games: [{ date: '09/01/2026', so: 6, outs: 18, bb: 2, ha: 5, er: 2, season: 2026, opp: 'X' }] }, { valueOf: (game) => game.so })
  const splits = buildSplits(model.games, { ...model, line: 5.5, today: parseGameDay('2026-09-03') })
  assert.ok(splits.rows.every((row) => row.id !== 'home' && row.id !== 'wins' && row.id !== 'vslhp'))
  assert.ok(splits.skipped.some((item) => item.startsWith('Home/Away')))
  assert.ok(splits.skipped.some((item) => item.startsWith('Wins/Losses')))
})

test('KBO hitters split by starter hand and derive rate stats', () => {
  const player = {
    type: 'batter',
    games: [
      { date: '2026-09-02', h: 2, ab: 4, bb: 1, tb: 5, hr: 1, r: 1, rbi: 2, hrr: 5, season: 2026, opp: 'X', opp_hand: 'L' },
      { date: '2026-09-01', h: 0, ab: 3, bb: 0, tb: 0, hr: 0, r: 0, rbi: 0, hrr: 0, season: 2026, opp: 'Y', opp_hand: 'R' },
    ],
  }
  const model = kboInsights(player, { valueOf: (game) => game.hrr })
  const splits = buildSplits(model.games, { ...model, line: 1.5, today: parseGameDay('2026-09-03') })
  const lhp = splits.rows.find((row) => row.id === 'vslhp')
  assert.equal(lhp.n, 1)
  assert.equal(lhp.rate, 100)
  const avg = model.metrics.find((metric) => metric.id === 'avg')
  const windows = metricWindows(avg, model.games, model)
  assert.equal(formatMetric(windows[0].value, avg.format), '.286')
  assert.equal(windows[0].small, true)
})

test('NFL pairs props by week for rate stats; no rest split', () => {
  const base = { gameDates: ['9/7', '9/14'], gameSeasons: [2026, 2026], gameOpponents: ['AA', 'BB'], recentSnapPercents: [80, 90], recentUsage: [8, 10], usageLabel: 'Targets' }
  const rows = [
    { ...base, prop: 'Receiving Yards', recent: [60, 100] },
    { ...base, prop: 'Receptions', recent: [5, 8] },
  ]
  const model = nflInsights(rows[0], rows, { currentSeason: 2026 })
  assert.equal(model.restApplies, false)
  const ids = model.metrics.map((metric) => metric.id)
  assert.ok(ids.includes('catch') && ids.includes('ypt') && ids.includes('ypc'))
  const ypt = model.metrics.find((metric) => metric.id === 'ypt')
  assert.equal(metricWindows(ypt, model.games, model)[0].value, 160 / 18)
  const splits = buildSplits(model.games, { ...model, line: 70.5, today: parseGameDay('2026-09-20') })
  assert.ok(!splits.rows.some((row) => row.group === 'Rest'))
})

test('NHL splits stay off the non-commercial logs until a source is approved', () => {
  const item = { log: [1, 2], logDates: ['10/10', '10/12'], logSeasons: ['2026-27', '2026-27'], logOpponents: ['A', 'B'], opponent: 'A' }
  const blocked = nhlInsights(item)
  assert.ok(blocked.splitsBlocked)
  assert.equal(blocked.games.length, 0)
  assert.equal(blocked.metrics.length, 0)
  const approved = nhlInsights(item, { sourceApproved: true })
  assert.equal(approved.splitsBlocked, null)
  assert.equal(approved.games[0].opp, 'B')
})

test('basketball: 0-minute games are left out of every metric and split; Minutes matches Minutes & Usage', () => {
  const logs = [
    nbaLog('10/22/2026', 30, 'AAA vs. BBB', 'W'),
    { ...nbaLog('10/21/2026', 0, 'AAA @ CCC', 'L'), min: 0, usg: null, reb: 0, ast: 0, fga: 0, fgm: 0, fg3a: 0, fg3m: 0, fta: 0, ftm: 0, tov: 0 },
    { ...nbaLog('10/19/2026', 22, 'AAA vs. BBB', 'W'), min: 24 },
    nbaLog('10/17/2026', 25, 'AAA @ BBB', 'W'),
    nbaLog('10/15/2026', 18, 'AAA vs. DDD', 'L'),
    nbaLog('10/13/2026', 20, 'AAA vs. DDD', 'L'),
  ]
  const model = nbaInsights(logs, { valueOf: (game) => game.pts, opponent: 'CCC' })
  const splits = buildSplits(model.games, { ...model, line: 19.5, today: parseGameDay('10/23/2026') })
  const byId = Object.fromEntries(splits.rows.map((row) => [row.id, row]))
  assert.equal(byId.season.n, 5)
  assert.equal(byId.vsopp.n, 0)
  assert.equal(byId.away.n, 1)
  for (const metric of model.metrics) {
    const windows = metricWindows(metric, model.games, model)
    assert.ok(windows.every((window) => window.n <= 5), `${metric.id} skips the DNP`)
    assert.ok(metricSeries(metric, model.games).length <= 5)
  }
  const minutes = model.metrics.find((metric) => metric.id === 'min')
  const [l5, l10, season] = metricWindows(minutes, model.games, model)
  assert.equal(l5.n, 4)
  assert.equal(l5.value, averageMetric(logs.slice(0, 5), 'min'))
  assert.equal(l10.value, averageMetric(logs.slice(0, 10), 'min'))
  assert.equal(season.value, averageMetric(logs, 'min'))
})

test('a capped log labels its oldest season as the last N games', () => {
  const games = Array.from({ length: 200 }, (_, index) => ({ date: `2026-09-${String((index % 28) + 1).padStart(2, '0')}`, hrr: index % 4, season: index < 144 ? 2026 : 2025, opp: 'X', h: 1, ab: 4 }))
  const model = kboInsights({ type: 'batter', games }, { valueOf: (game) => game.hrr })
  const splits = buildSplits(model.games, { ...model, line: 1.5, today: parseGameDay('2026-10-01') })
  const byId = Object.fromEntries(splits.rows.map((row) => [row.id, row]))
  assert.equal(byId.season.label, '2026 season')
  assert.equal(byId.prior.label, 'Last 56 games of 2025')
  const avg = model.metrics.find((metric) => metric.id === 'avg')
  const windows = metricWindows(avg, model.games, model)
  assert.equal(windows.find((window) => window.id === 'prior').label, 'Last 56 of 2025')
  const short = kboInsights({ type: 'batter', games: games.slice(0, 199) }, { valueOf: (game) => game.hrr })
  assert.equal(buildSplits(short.games, { ...short, line: 1.5 }).rows.find((row) => row.id === 'prior').label, '2025 season')
})

test('WNBA: a 40-game log with playoffs is labeled as such', () => {
  const logs = Array.from({ length: 40 }, (_, index) => ({ date: `09/${String(30 - (index % 28)).padStart(2, '0')}/2026`, pts: 10 + (index % 5), min: 30, matchup: 'AAA vs BBB', ...(index < 3 ? { postseason: true } : {}) }))
  const model = wnbaInsights(logs, { valueOf: (game) => game.pts })
  const season = buildSplits(model.games, { ...model, line: 11.5 }).rows.find((row) => row.id === 'season')
  assert.equal(season.label, 'Last 40 games of 2026, incl. playoffs')
  const minutes = model.metrics.find((metric) => metric.id === 'min')
  const windows = metricWindows(minutes, model.games, model)
  assert.equal(windows.find((window) => window.id === 'season').label, 'Last 40 of 2026')
  assert.ok(windows.some((window) => window.playoffs))
})

test('pushes leave the hit rate and the shown n', () => {
  const games = [6, 5, 5, 4, 7].map((so, index) => ({ date: `2026-09-${10 + index * 5}`, so, outs: 18, season: 2026, opp: 'X' }))
  const model = kboInsights({ type: 'pitcher', games }, { valueOf: (game) => game.so })
  const season = buildSplits(model.games, { ...model, line: 5 }).rows.find((row) => row.id === 'season')
  assert.equal(season.n, 5)
  assert.equal(season.pushes, 2)
  assert.equal(season.shown, 3)
  assert.equal(season.rate, 67)
})

test('NFL opponent split matches team-code aliases', () => {
  assert.equal(nflTeamKey('LA'), nflTeamKey('LAR'))
  assert.equal(nflTeamKey('JAC'), nflTeamKey('JAX'))
  assert.equal(nflTeamKey('WSH'), nflTeamKey('WAS'))
  assert.equal(nflTeamKey('OAK'), nflTeamKey('LV'))
  const row = { prop: 'Rush Yards', recent: [50, 80], gameDates: ['9/7', '9/14'], gameSeasons: [2026, 2026], gameOpponents: ['LA', 'SF'], opponent: 'LAR' }
  const model = nflInsights(row, [row], { currentSeason: 2026 })
  const vs = buildSplits(model.games, { ...model, line: 60.5 }).rows.find((entry) => entry.id === 'vsopp')
  assert.equal(vs.label, 'vs LAR')
  assert.equal(vs.n, 1)
})

test('WNBA and NBA opponent splits match team-code aliases', () => {
  for (const [a, b] of [['GS', 'GSV'], ['LA', 'LAS'], ['LV', 'LVA'], ['NY', 'NYL'], ['WSH', 'WAS'], ['POR', 'PDX']]) assert.equal(wnbaTeamKey(a), wnbaTeamKey(b))
  for (const [a, b] of [['GS', 'GSW'], ['NO', 'NOP'], ['NY', 'NYK'], ['SA', 'SAS'], ['UTAH', 'UTA'], ['PHO', 'PHX']]) assert.equal(nbaTeamKey(a), nbaTeamKey(b))
  const logs = [
    { date: '10/05/2026', opponent: 'GS', matchup: 'ATL @ GS', pts: 20, min: 30, postseason: true },
    { date: '10/03/2026', opponent: 'GSV', matchup: 'ATL vs. GSV', pts: 10, min: 30, postseason: true },
    { date: '09/01/2026', opponent: 'NY', matchup: 'ATL @ NY', pts: 12, min: 30 },
  ]
  const model = wnbaInsights(logs, { valueOf: (game) => game.pts, opponent: 'GSV' })
  const vs = buildSplits(model.games, { ...model, line: 15.5 }).rows.find((entry) => entry.id === 'vsopp')
  assert.equal(vs.label, 'vs GSV')
  assert.equal(vs.n, 2)
})

test('KBO pitchers hide empty rest rows; hitters keep them', () => {
  const games = [{ date: '2026-09-12', so: 6, season: 2026 }, { date: '2026-09-06', so: 5, season: 2026 }, { date: '2026-09-01', so: 7, season: 2026 }]
  const pitcher = kboInsights({ type: 'pitcher', games }, { valueOf: (game) => game.so })
  const rows = buildSplits(pitcher.games, { ...pitcher, line: 5.5 }).rows
  assert.deepEqual(rows.filter((row) => row.group === 'Rest').map((row) => row.id), ['rest2'])
  const hitter = kboInsights({ type: 'batter', games: games.map((game) => ({ ...game, hrr: 1 })) }, { valueOf: (game) => game.hrr })
  assert.equal(buildSplits(hitter.games, { ...hitter, line: 0.5 }).rows.filter((row) => row.group === 'Rest').length, 3)
})

test('early-season notice uses a per-sport threshold', () => {
  assert.deepEqual({ ...EARLY_SEASON_GAMES }, { nba: 10, wnba: 6, nfl: 4, kboHitter: 15, kboPitcher: 5, nhl: 10 })
  const nfl = (count) => {
    const recent = Array.from({ length: count }, () => 50)
    const row = { prop: 'Rush Yards', recent, gameDates: recent.map((_, i) => `9/${7 + i * 7}`), gameSeasons: recent.map(() => 2026), gameOpponents: recent.map(() => 'SF') }
    const model = nflInsights(row, [row], { currentSeason: 2026 })
    return buildSplits(model.games, { ...model, line: 40.5 }).rows.find((entry) => entry.id === 'season').early
  }
  assert.equal(nfl(3), true)
  assert.equal(nfl(4), false)
})

test('item 1 switch: this season only, or both seasons labeled', () => {
  const logs = [
    nbaLog('10/22/2026', 30, 'AAA vs. BBB', 'W'),
    nbaLog('10/20/2026', 12, 'AAA @ BBB', 'L'),
    ...Array.from({ length: 8 }, (_, i) => nbaLog(`04/${String(10 - i).padStart(2, '0')}/2026`, 20, 'AAA vs. CCC', 'W', '2026')),
  ]
  const model = nbaInsights(logs, { valueOf: (game) => game.pts, opponent: 'BBB' })
  assert.equal(model.recentScope, 'all')
  const minutes = model.metrics.find((metric) => metric.id === 'min')
  assert.deepEqual(metricWindows(minutes, model.games, model).map((window) => window.label), ['L5', 'L10', "'26-27", "'25-26"])

  const seasonOnly = { ...model, recentScope: 'season' }
  assert.deepEqual(metricWindows(minutes, model.games, seasonOnly).map((window) => window.id), ['season', 'prior'])
  const home = buildSplits(model.games, { ...seasonOnly, line: 19.5 }).rows.find((row) => row.id === 'home')
  assert.equal(home.n, 1)

  const both = { ...model, recentScope: 'both' }
  assert.deepEqual(metricWindows(minutes, model.games, both).slice(0, 2).map((window) => window.label), ['L5 · both seasons', 'L10 · both seasons'])
  const bothRows = buildSplits(model.games, { ...both, line: 19.5 }).rows
  assert.equal(bothRows.find((row) => row.id === 'home').group, 'Venue · both seasons')
  assert.equal(bothRows.find((row) => row.id === 'home').n, 9)
})

test('bar labels stay short enough for a 320px strip', () => {
  const days = ['2026-09-29', '2026-10-01', '2026-10-10', '2026-10-12'].map((text) => parseGameDay(text))
  assert.deepEqual(seriesDayLabels(days), ['29', '1', '10', '12'])
  assert.equal(seriesRange(days), '9/29–10/12')
  assert.equal(seriesValueLabel(34.46, 'one'), '34')
  assert.equal(seriesValueLabel(4.5, 'two'), '4.5')
  assert.equal(seriesValueLabel(0.256, 'pct'), '26')
  assert.equal(seriesValueLabel(0.5, 'avg3'), '.500')
  assert.equal(seriesLabelsVertical(['34', '4.5', '100']), false)
  assert.equal(seriesLabelsVertical(['.500', '.250']), true)
})

test('strength scale: bands, muted tiny samples and lowerIsBetter', async () => {
  const { strengthTone, isLowerBetter, registerStatDirection, STRENGTH_MIN_GAMES } = await import('../src/playerInsights/strengthScale.js')
  assert.equal(STRENGTH_MIN_GAMES, 3)
  assert.equal(strengthTone(70, 50, { kind: 'rate', n: 10 }).tone, 'strong')
  assert.equal(strengthTone(58, 50, { kind: 'rate', n: 10 }).tone, 'good')
  assert.equal(strengthTone(53, 50, { kind: 'rate', n: 10 }).tone, 'neutral')
  assert.equal(strengthTone(42, 50, { kind: 'rate', n: 10 }).tone, 'soft')
  assert.equal(strengthTone(30, 50, { kind: 'rate', n: 10 }).tone, 'weak')
  assert.equal(strengthTone(12, 10, { n: 5 }).tone, 'strong')
  assert.equal(strengthTone(10.3, 10, { n: 5 }).tone, 'neutral')
  assert.equal(strengthTone(90, 10, { n: 2 }).tone, 'muted')
  assert.equal(strengthTone(90, 10, { n: 2 }).cue, '')
  assert.equal(strengthTone(12, 10, { n: 5 }).cue, '▲')
  assert.equal(strengthTone(2.0, 4.0, { n: 6, lowerIsBetter: true }).tone, 'strong')
  assert.equal(strengthTone(6.0, 4.0, { n: 6, lowerIsBetter: true }).tone, 'weak')
  assert.equal(isLowerBetter('nba', 'Turnovers'), true)
  assert.equal(isLowerBetter('kbo', 'Hits Allowed'), true)
  assert.equal(isLowerBetter('nfl', 'Pass Interceptions'), true)
  assert.equal(isLowerBetter('kbo', 'Pitcher Strikeouts'), false)
  assert.equal(isLowerBetter('kbo', null, { id: 'era' }), true)
  assert.equal(isLowerBetter('kbo', null, { id: 'k9', lowerIsBetter: false }), false)
  registerStatDirection('testsport', 'Saves Allowed', { lowerIsBetter: true })
  assert.equal(isLowerBetter('testsport', 'saves allowed'), true)
  assert.equal(isLowerBetter('othersport', 'saves allowed'), false)
})

test('splits color each row vs the overall hit rate; lowerIsBetter flips it', () => {
  const values = [30, 30, 30, 30, 10, 10, 10, 10, 10, 10]
  const logs = values.map((pts, i) => ({ date: `10/${String(20 - i).padStart(2, '0')}/2026`, matchup: i < 4 ? 'ATL vs. NY' : 'ATL @ NY', opponent: 'NY', pts, min: 30 }))
  const model = wnbaInsights(logs, { valueOf: (game) => game.pts, opponent: 'NYL' })
  const splits = buildSplits(model.games, { ...model, line: 20.5, today: parseGameDay('10/21/2026') })
  assert.equal(splits.baseline.kind, 'rate')
  assert.equal(splits.baseline.value, 40)
  const home = splits.rows.find((r) => r.id === 'home')
  const away = splits.rows.find((r) => r.id === 'away')
  assert.equal(home.strength.tone, 'strong')
  assert.equal(away.strength.tone, 'weak')
  const flipped = buildSplits(model.games, { ...model, line: 20.5, lowerIsBetter: true, today: parseGameDay('10/21/2026') })
  assert.equal(flipped.rows.find((r) => r.id === 'home').strength.tone, 'weak')
  const rest0 = splits.rows.find((r) => r.id === 'rest0')
  assert.ok(rest0.n === 0 || rest0.strength.tone === 'muted' || rest0.shown >= 3)
  const tiny = buildSplits(model.games.slice(0, 2), { ...model, line: 20.5 })
  assert.ok(tiny.rows.every((r) => r.strength.tone === 'muted'))
  const noLine = buildSplits(model.games, { ...model, line: null })
  assert.equal(noLine.baseline.kind, 'ratio')
  assert.equal(noLine.rows.find((r) => r.id === 'home').strength.tone, 'strong')
})

test('advanced windows: published baseline wins, else own season; ERA lower is better', async () => {
  const { rateWindows } = await import('../src/playerInsights/insightsCore.js')
  const { registerBaselineProvider } = await import('../src/playerInsights/strengthScale.js')
  const era = { id: 'era', lowerIsBetter: true }
  const windows = [
    { id: 'l5', label: 'L5', n: 5, value: 2.0 },
    { id: 'l10', label: 'L10', n: 2, value: 9.0 },
    { id: 'season', label: '2026', n: 20, value: 4.0 },
  ]
  const own = rateWindows(windows, era, { sport: 'kbo' })
  assert.equal(own.baseline.source, 'season')
  assert.equal(own.windows[0].strength.tone, 'strong')
  assert.equal(own.windows[1].strength.tone, 'muted')
  assert.equal(own.windows[2].isBaseline, true)
  registerBaselineProvider('kbo', (metric) => (metric.id === 'era' ? { value: 2.1, label: 'KBO league average' } : null))
  const league = rateWindows(windows, era, { sport: 'kbo' })
  assert.equal(league.baseline.source, 'published')
  assert.equal(league.windows[2].strength.tone, 'weak')
  registerBaselineProvider('kbo', null)
  assert.equal(rateWindows(windows, era, { sport: 'kbo' }).baseline.source, 'season')
})

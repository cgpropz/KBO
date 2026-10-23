// NHL wiring for the shared strength scale. Made-up numbers only.
import test from 'node:test'
import assert from 'node:assert/strict'
import { baselineFor, isLowerBetter, strengthTone } from '../src/playerInsights/strengthScale.js'
import { rateWindows } from '../src/playerInsights/insightsCore.js'
import { nhlApiInsights } from '../src/nhl/nhlPlayerParity.js'
import { NHL_POSITION_BASELINES } from '../src/nhl/nhlStatScale.js'

const SEASONS = { current: '2026-27', prior: '2025-26' }

test('NHL lower-is-better stats are registered by id and label', () => {
  for (const id of ['gaa', 'goalsAgainst', 'giveaways', 'pim', 'oppDefRank']) assert.equal(isLowerBetter('nhl', id), true, id)
  for (const label of ['GAA', 'Goals against', 'Giveaways', 'PIM', 'Opp def rank']) assert.equal(isLowerBetter('nhl', label), true, label)
  for (const id of ['svPct', 'shPct', 'sog60', 'saves', 'Shots On Goal']) assert.equal(isLowerBetter('nhl', id), false, id)
})

test('NHL API metrics compare with the published position baseline', () => {
  const skater = nhlApiInsights({ prop: 'Shots On Goal', position: 'D' }, [], { seasons: SEASONS })
  const sog60 = skater.metrics.find((metric) => metric.id === 'sog60')
  const base = baselineFor(sog60, skater, [])
  assert.equal(base.value, NHL_POSITION_BASELINES.D.sog60)
  assert.equal(base.source, 'published')
  assert.match(base.label, /defense average/)
  const fwd = nhlApiInsights({ prop: 'Points', position: 'C' }, [], { seasons: SEASONS })
  const fo = fwd.metrics.find((metric) => metric.id === 'foPct') || { id: 'foPct' }
  assert.equal(baselineFor(fo, fwd, []).value, NHL_POSITION_BASELINES.C.foPct)
  assert.match(baselineFor(fo, fwd, []).label, /center average/)

  const goalie = nhlApiInsights({ prop: 'Goalie Saves' }, [], { seasons: SEASONS })
  const gaa = goalie.metrics.find((metric) => metric.id === 'gaa')
  assert.equal(gaa.lowerIsBetter, true)
  assert.equal(baselineFor(gaa, goalie, []).value, NHL_POSITION_BASELINES.G.gaa)
  const rated = rateWindows([{ id: 'l10', label: 'L10', n: 10, value: 2.2 }, { id: 'season', label: 'Season', n: 12, value: 3.6 }], gaa, goalie)
  assert.equal(rated.lowerIsBetter, true)
  assert.equal(rated.windows[0].strength.tone, 'strong') // fewer goals against than the goalie average
  assert.equal(rated.windows[1].strength.tone, 'weak')
  assert.equal(strengthTone(0.92, NHL_POSITION_BASELINES.G.svPct, { n: 10 }).tone, 'neutral')
})

test('a metric with no published baseline falls back to the player season', () => {
  const skater = nhlApiInsights({ prop: 'Points' }, [], { seasons: SEASONS })
  const base = baselineFor({ id: 'unknownStat' }, skater, [{ id: 'season', label: '2026-27', n: 5, value: 1 }])
  assert.equal(base.source, 'season')
})

test('SH TOI, shifts and shots against are neutral: shown, never colored', async () => {
  const { isNeutralStat } = await import('../src/playerInsights/strengthScale.js')
  for (const id of ['shToi', 'shifts', 'sa']) assert.equal(isNeutralStat('nhl', id), true, id)
  for (const label of ['SH TOI / game (min)', 'Shifts / game', 'Shots against']) assert.equal(isNeutralStat('nhl', label), true, label)
  const skater = nhlApiInsights({ prop: 'Points' }, [], { seasons: SEASONS })
  const shifts = skater.metrics.find((metric) => metric.id === 'shifts')
  assert.equal(shifts.neutral, true)
  const rated = rateWindows([{ id: 'l5', label: 'L5', n: 5, value: 40 }, { id: 'season', label: 'Season', n: 9, value: 10 }], shifts, skater)
  assert.equal(rated.neutral, true)
  assert.ok(rated.windows.every((window) => window.strength.tone === 'unrated' && window.strength.cue === ''))
  const goalie = nhlApiInsights({ prop: 'Goalie Saves' }, [], { seasons: SEASONS })
  const sa = goalie.metrics.find((metric) => metric.id === 'sa')
  assert.equal(rateWindows([{ id: 'l5', label: 'L5', n: 5, value: 40 }], sa, goalie).neutral, true)
  assert.equal(goalie.metrics.find((metric) => metric.id === 'gaa').neutral, false)
})

test('NHL split rows color by over rate with no direction flip', async () => {
  const { buildSplits } = await import('../src/playerInsights/insightsCore.js')
  const games = []
  for (let index = 0; index < 12; index += 1) {
    const home = index % 2 === 0
    games.push({ d: `2026-10-${String(22 - index).padStart(2, '0')}`, s: '2026-27', opp: 'TST', h: home ? 1 : 0, res: 'W', sv: home ? 30 : 15, sa: 32, ga: 2, toi: 60 })
  }
  const { decodeNhlApiLog } = await import('../src/nhl/nhlPlayerParity.js')
  const decoded = decodeNhlApiLog({ kind: 'goalie', cols: ['d', 's', 'opp', 'h', 'res', 'sa', 'sv', 'ga', 'toi'], games: games.map((game) => [game.d, game.s, game.opp, game.h, game.res, game.sa, game.sv, game.ga, game.toi * 60]) })
  const model = nhlApiInsights({ prop: 'Goalie Saves' }, decoded, { seasons: SEASONS })
  assert.equal(model.better, undefined)
  const splits = buildSplits(model.games, { ...model, line: 20.5, today: model.games[0].day })
  const byId = Object.fromEntries(splits.rows.map((row) => [row.id, row]))
  assert.ok(byId.home.strength.level > 0) // overs at home: green
  assert.ok(byId.away.strength.level < 0) // unders away: red
})

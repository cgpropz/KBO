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

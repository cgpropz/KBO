import assert from 'node:assert/strict'
import test from 'node:test'
import { formatRecord, kboHubRows, nbaHubRows, nhlHubRows, nflHubRows, recapLabel, topHubRows } from '../src/memberHub.js'
import { standardRecord } from '../scripts/write-member-recap.mjs'

test('hub rows keep standard lines only', () => {
  const kbo = kboHubRows({ cards: [{ name: 'A', props: [
    { stat: 'Hits', line: 0.5, odds_type: 'goblin', cg_projection: 90 },
    { stat: 'Hits', line: 1.5, odds_type: 'standard', cg_projection: 70, projection: 1.8, recommendation: 'OVER' },
  ] }] })
  assert.equal(kbo.length, 1)
  assert.equal(kbo[0].score, 70)
  const nhl = nhlHubRows([{ player: 'B', prop: 'Points', line: 0.5, projection: 1, oddsType: 'demon' }, { player: 'C', prop: 'Points', line: 0.5, projection: 1, oddsType: 'standard' }])
  assert.deepEqual(nhl.map((r) => r.player), ['C'])
  const nfl = nflHubRows([{ player: 'D', prop: 'Receptions', line: 4.5, projection: 6, line_type: 'goblin' }])
  assert.equal(nfl.length, 0)
  const nba = nbaHubRows([{ name: 'E', ppAllProps: [{ stat: 'Points', line: 9.5, standardLine: 9.5, rating: 60, projection: 11 }, { stat: 'Points', line: 7.5, standardLine: 9.5, rating: 80 }] }])
  assert.deepEqual(nba.map((r) => r.score), [60])
})

test('top rows are one per player, best score first', () => {
  const rows = [
    { player: 'A', stat: 's', line: 1, score: 60 },
    { player: 'A', stat: 't', line: 1, score: 90 },
    { player: 'B', stat: 's', line: 1, score: 70 },
    { player: 'C', stat: 's', line: 1, score: NaN },
  ]
  assert.deepEqual(topHubRows(rows).map((r) => [r.player, r.score]), [['A', 90], ['B', 70]])
})

test('record counts standard graded lines and labels the slate', () => {
  const r = standardRecord({ props: [
    { odds_type: 'standard', model_result: 'HIT' },
    { odds_type: 'standard', model_result: 'MISS' },
    { odds_type: 'standard', model_result: 'PUSH' },
    { odds_type: 'demon', model_result: 'HIT' },
    { odds_type: 'standard', model_result: 'HIT', rank_eligible: false },
    { odds_type: 'standard', model_result: 'N/A' },
  ] })
  assert.deepEqual(r, { hits: 1, misses: 1, pushes: 1 })
  assert.equal(formatRecord(r), '1-1-1')
  const now = new Date('2026-10-14T03:30:00Z')
  assert.equal(recapLabel('2026-10-12', now), 'Yesterday')
  assert.equal(recapLabel('2026-09-27', now), 'Last graded Sep 27')
})

import assert from 'node:assert/strict'
import test from 'node:test'
import { hubPayload } from '../src/hubPayload.js'

test('hub rows keep standard lines, drop promo lines and the embedded detail, and cap the chart', () => {
  const recent = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]
  const data = [
    {
      player: 'A', prop: 'Receptions', line: 4.5, projection: 6, line_type: 'standard',
      recent, imageUrl: 'https://example.test/a.png', profile: { toi: 1 },
    },
    { player: 'B', prop: 'Receptions', line: 4.5, projection: 6, line_type: 'goblin' },
    { player: 'C', prop: 'Receptions', line: 4.5, projection: 6, oddsType: 'demon' },
  ]
  const out = hubPayload('nfl_projections', data)
  assert.equal(out.hub, true)
  assert.equal(out.rows.length, 1)
  assert.equal(out.rows[0].player, 'A')
  assert.equal(out.rows[0].detail, undefined)
  assert.equal(out.rows[0].profile, undefined)
  assert.equal(out.rows[0].recent.length, 10)
  assert.deepEqual(out.rows[0].recent, recent.slice(-10))
})

test('kbo hub rows are built from the raw card, including games when recent_values is empty', () => {
  const data = {
    cards: [{
      name: 'Kim',
      team: 'LG',
      opponent: 'KT',
      games: [{ date: '2026-09-01', hrr: 2 }, { date: '2026-09-02', hrr: 1 }],
      props: [
        { stat: 'Hits+Runs+RBIs', line: 1.5, projection: 2, cg_projection: 60, recommendation: 'OVER', odds_type: 'standard' },
        { stat: 'Hits+Runs+RBIs', line: 2.5, projection: 2, cg_projection: 40, recommendation: 'OVER', odds_type: 'goblin' },
      ],
    }],
  }
  const out = hubPayload('prizepicks_props', data)
  assert.equal(out.rows.length, 1)
  assert.equal(out.rows[0].player, 'Kim')
  assert.ok(out.rows[0].recent.length >= 1)
  assert.equal(out.rows[0].detail, undefined)
  assert.equal(out.rows[0].games, undefined)
})

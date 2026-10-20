import test from 'node:test'
import assert from 'node:assert/strict'
import { DATASETS, shapeForTier } from '../api/_dataAccess.js'
import { kboRawRating, scoreFor } from '../src/kboBoardScore.js'
import { kboHubRows, playableRows, topHubRows } from '../src/memberHub.js'
import { selectFreeTop3 } from '../src/freeTopPicks.js'
import { keepSlipRow } from '../src/slipAvailability.js'

// 10/19 8:12 PM ET: PrizePicks has no KBO lines, so the build marks every
// prop pulled (removed + pp_status 'removed'); Park TB alone pulled is the
// single-missing-line case.
const START = '2026-10-20T18:30:00+09:00'
const NOW = new Date('2026-10-20T00:15:00Z')
const pulled = { removed: true, pp_status: 'removed', pulled_reason: 'prizepicks_no_kbo_lines' }
const prop = (stat, line, projection, extra = {}) => ({ stat, line, projection, odds_type: 'standard', recommendation: 'OVER', ...extra })
function slate(pulledFor = () => false) {
  const card = (name, team, props) => ({ name, team, opponent: team === 'LG' ? 'Kia' : 'LG', start_time: START, game_date: '2026-10-20', props: props.map((p) => (pulledFor(name, p.stat) ? { ...p, ...pulled } : p)) })
  return { cards: [
    card('Dong Won Park', 'LG', [prop('Total Bases', 0.5, 0.97)]),
    card('Harold Castro', 'Kia', [prop('Hitter Fantasy Score', 6, 8.87)]),
    card('Kim Do-yeong', 'Kia', [prop('Hitter Fantasy Score', 6.5, 8.96)]),
    card('Park Hae-min', 'LG', [prop('Hitter Fantasy Score', 5, 6.84)]),
  ] }
}
const allPulled = () => slate(() => true)
const parkPulled = () => slate((name) => name === 'Dong Won Park')
const names = (cards) => cards.flatMap((c) => c.props.map((p) => `${c.name}|${p.stat}`))

test('board score: a pulled prop has no CG Score', () => {
  assert.equal(scoreFor({ ...prop('Total Bases', 0.5, 0.97), ...pulled }), null)
  assert.equal(scoreFor({ ...prop('Total Bases', 0.5, 0.97), pp_status: 'removed' }), null)
  assert.ok(scoreFor(prop('Total Bases', 0.5, 0.97)) > 90)
})

test('API free preview and paid board drop pulled props (all pulled, and one pulled)', () => {
  const freeAll = shapeForTier('prizepicks_props', allPulled(), 'free')
  assert.deepEqual(names(freeAll.data.cards), [])
  const freeOne = shapeForTier('prizepicks_props', parkPulled(), 'free')
  assert.deepEqual(names(freeOne.data.cards), ['Harold Castro|Hitter Fantasy Score', 'Kim Do-yeong|Hitter Fantasy Score', 'Park Hae-min|Hitter Fantasy Score'])
  const paid = shapeForTier('prizepicks_props', parkPulled(), 'combined')
  assert.equal(names(paid.data.cards).includes('Dong Won Park|Total Bases'), false)
})

test('free top 3 (FreePicksPreview rows) skips pulled props', () => {
  const rows = (board) => board.cards.flatMap((card) => card.props.map((p) => ({
    player: card.name, stat: p.stat, line: p.line, projection: p.projection, start_time: card.start_time,
    removed: p.removed === true, score: scoreFor(p) ?? -Infinity, rawScore: kboRawRating(p.projection, p.line, p.stat),
  })))
  assert.deepEqual(selectFreeTop3(rows(allPulled()), 'kbo', NOW), [])
  assert.deepEqual(selectFreeTop3(rows(parkPulled()), 'kbo', NOW).map((r) => r.player), ['Harold Castro', 'Kim Do-yeong', 'Park Hae-min'])
})

test('hub / landing rows skip pulled props', () => {
  assert.deepEqual(topHubRows(playableRows(kboHubRows(allPulled())), 3), [])
  assert.equal(topHubRows(playableRows(kboHubRows(parkPulled())), 3).some((r) => r.player === 'Dong Won Park'), false)
})

test('slip builder drops a pulled projection row; projection preview skips it', () => {
  const row = { name: 'Dong Won Park', prop: 'Total Bases', line: 0.5, projection: 0.97, odds_type: 'standard', start_time: START }
  assert.equal(keepSlipRow({ ...row, ppStatus: 'removed', removed: true }, { now: NOW }), false)
  assert.equal(keepSlipRow(row, { now: NOW }), true)
  const res = DATASETS.batter_projections.free({ projections: [
    { ...row, rating: 96.6, ...pulled },
    { name: 'Harold Castro', prop: 'Fantasy Score', line: 6, projection: 8.87, rating: 73.9 },
  ] })
  assert.deepEqual(res.data.projections.map((r) => r.name), ['Harold Castro'])
})

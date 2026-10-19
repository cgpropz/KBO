import test from 'node:test'
import assert from 'node:assert/strict'
import { DATASETS } from '../api/_dataAccess.js'
import { hasModelNumber, scoreFor } from '../src/kboBoardScore.js'

// 10/20 slate shapes. Total Bases runs on the standing model, so
// formula_applied is false but the projection is a real model number.
const parkTb = {
  stat: 'Total Bases', line: 0.5, odds_type: 'standard', projection: 0.97, rating: 96.6,
  formula_applied: false, formula_source: 'current',
}
const castro = { stat: 'Hitter Fantasy Score', line: 6, odds_type: 'standard', projection: 8.87, rating: 73.9, formula_applied: true, formula_source: 'tuned' }
const kim = { stat: 'Hitter Fantasy Score', line: 6.5, odds_type: 'standard', projection: 8.96, rating: 68.9, formula_applied: true, formula_source: 'tuned' }
const parkHm = { stat: 'Hitter Fantasy Score', line: 5, odds_type: 'standard', projection: 6.84, rating: 68.4, formula_applied: true, formula_source: 'tuned' }
const moon = { stat: 'Hitter Fantasy Score', line: 4.5, odds_type: 'standard', projection: null, rating: null, formula_applied: false, formula_source: 'none' }

test('current-model rows keep their CG Score; formula_applied=false alone does not unrate', () => {
  assert.equal(hasModelNumber(parkTb), true)
  assert.ok(Math.abs(scoreFor(parkTb) - 97) < 1e-9)
})

test("formula_source 'none' is unrated even if a projection or rating leaked in", () => {
  assert.equal(scoreFor(moon), null)
  assert.equal(scoreFor({ ...moon, projection: 9.9, rating: 99 }), null)
  assert.equal(hasModelNumber({ ...moon, projection: 9.9 }), false)
})

test('free preview never picks an unmodeled row and keeps formulated order', () => {
  const res = DATASETS.prizepicks_props.free({
    cards: [
      { name: 'Moon Jeong-bin', props: [{ ...moon, projection: 50, rating: 100 }] },
      { name: 'Dong Won Park', props: [parkTb] },
      { name: 'Harold Castro', props: [castro] },
      { name: 'Kim Do-yeong', props: [kim] },
      { name: 'Park Hae-min', props: [parkHm] },
    ],
  })
  const picked = res.data.cards.flatMap((card) => card.props.map((prop) => `${card.name}|${prop.stat}`))
  assert.deepEqual(picked.sort(), ['Dong Won Park|Total Bases', 'Harold Castro|Hitter Fantasy Score', 'Kim Do-yeong|Hitter Fantasy Score'].sort())
})

test('batter_projections preview skips rows with no model number', () => {
  const res = DATASETS.batter_projections.free({
    projections: [
      { name: 'Ghost', prop: 'Fantasy Score', line: 4.5, projection: null, rating: 99, formula_source: 'none' },
      { name: 'Ghost2', prop: 'Fantasy Score', line: 4.5, projection: 9, rating: 99, formula_source: 'none' },
      { name: 'Dong Won Park', prop: 'Total Bases', line: 0.5, projection: 0.97, rating: 96.6, formula_source: 'current' },
      { name: 'Harold Castro', prop: 'Fantasy Score', line: 6, projection: 8.87, rating: 73.9, formula_source: 'tuned' },
      { name: 'Kim Do-yeong', prop: 'Fantasy Score', line: 6.5, projection: 8.96, rating: 68.9, formula_source: 'tuned' },
    ],
  })
  assert.deepEqual(res.data.projections.map((row) => row.name), ['Dong Won Park', 'Harold Castro', 'Kim Do-yeong'])
})

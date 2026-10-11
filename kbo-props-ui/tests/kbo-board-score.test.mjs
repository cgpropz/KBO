import test from 'node:test'
import assert from 'node:assert/strict'
import { DATASETS } from '../api/_dataAccess.js'
import { directionFor, playerHeaderBadge, pregameSide, scoreFor } from '../src/kboBoardScore.js'

test('CG Score is the model ratio, not a confidence score on an under', () => {
  const prop = {
    stat: 'Hits+Runs+RBIs',
    line: 2.5,
    projection: 2.49,
    avg: 4.82,
    rating: 49.8,
    cg_projection: 90,
    recommendation: 'PUSH',
  }
  assert.ok(Math.abs(scoreFor(prop) - (2.49 / 2.5) * 50) < 1e-9)
  assert.ok(scoreFor(prop) < 50)
  assert.equal(directionFor(prop), 'under')
  assert.equal(pregameSide(2.49, 2.5), 'UNDER')
})

test('a missing model projection is unrated and does not use the season average', () => {
  const prop = { stat: 'Pitcher Strikeouts', line: 5.5, avg: 7.4, cg_projection: 95, rating: 67 }
  assert.equal(scoreFor(prop), null)
  assert.equal(directionFor(prop), 'neutral')
  assert.equal(pregameSide(null, 5.5), 'NO LINE')
  assert.equal(pregameSide(5.5, 5.5), 'EVEN')
})

test('an explicit null projection is unrated even when avg is filled', () => {
  const prop = { stat: 'Hits+Runs+RBIs', line: 1.5, projection: null, avg: 3.2, cg_projection: 88 }
  assert.equal(scoreFor(prop), null)
  assert.equal(directionFor(prop), 'neutral')
})

test('free preview drops a confidence-95 under behind a real over and skips a missing projection', () => {
  const preview = DATASETS.prizepicks_props.free
  const res = preview({
    cards: [
      { name: 'Under', props: [{ stat: 'Hits+Runs+RBIs', line: 2.5, projection: 2.2, cg_projection: 95, avg: 4.8 }] },
      { name: 'Over', props: [{ stat: 'Hits+Runs+RBIs', line: 2.5, projection: 3.1, cg_projection: 40, avg: 1.1 }] },
      { name: 'Missing', props: [{ stat: 'Hits+Runs+RBIs', line: 2.5, cg_projection: 99, avg: 6 }] },
    ],
  })
  assert.deepEqual(res.data.cards.map((card) => card.name), ['Over', 'Under'])
  assert.equal(res.lockedCount, 1)
})

test('player header uses the board CG Score, not the confidence score', () => {
  const prop = {
    stat: 'Total Bases',
    line: 2,
    projection: 2.332,
    avg: 1.4,
    cg_projection: 84,
  }
  const badge = playerHeaderBadge(prop)
  assert.equal(badge.scoreText, '58.3')
  assert.equal(badge.label, 'OVER')
  assert.equal(badge.side, 'over')
  assert.equal(playerHeaderBadge({ stat: 'Total Bases', line: 2, avg: 3, cg_projection: 84 }), null)
})

test('projection-page preview ranks rating, not the confidence score', () => {
  const preview = DATASETS.strikeout_projections.free
  const res = preview({
    projections: [
      { name: 'High confidence under', prop: 'Strikeouts', line: 5.5, projection: 4.0, rating: 36.4, cg_projection: 95 },
      { name: 'Clear over', prop: 'Strikeouts', line: 5.5, projection: 6.4, rating: 58.2, cg_projection: 40 },
      { name: 'Another over', prop: 'Strikeouts', line: 5.5, projection: 6.0, rating: 54.5, cg_projection: 10 },
      { name: 'Smaller over', prop: 'Strikeouts', line: 5.5, projection: 5.6, rating: 50.9, cg_projection: 80 },
    ],
  })
  assert.deepEqual(res.data.projections.map((row) => row.name), ['Clear over', 'Another over', 'Smaller over'])
})

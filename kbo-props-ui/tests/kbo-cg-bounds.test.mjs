import test from 'node:test'
import assert from 'node:assert/strict'
import { boundCg } from '../src/cgScore.js'
import { scoreFor } from '../src/kboBoardScore.js'

test('KBO board CG Score is bounded 0-100 and keeps order inside the range', () => {
  // Total Bases O0.5 at a 1.316 projection used to show 131.6.
  assert.equal(scoreFor({ stat: 'Total Bases', line: 0.5, projection: 1.316 }), 100)
  assert.equal(scoreFor({ stat: 'Total Bases', line: 1.5, projection: 1.8 }), (1.8 / 1.5) * 50)
  assert.equal(scoreFor({ stat: 'Strikeouts', line: 4.5, projection: 3.6 }), (3.6 / 4.5) * 50)
  assert.equal(boundCg(-3), 0)
  assert.equal(boundCg(null), null)
})

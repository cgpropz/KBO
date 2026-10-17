import assert from 'node:assert/strict'
import test from 'node:test'
import { boardErrorText, isTierPending } from '../src/boardLoadError.js'

test('a tier_pending error keeps its code and message', () => {
  const error = Object.assign(new Error("Couldn't confirm your membership. Please retry."), { code: 'tier_pending', status: 503 })
  assert.equal(isTierPending(error), true)
  assert.equal(boardErrorText(error), "Couldn't confirm your membership. Please retry.")
  assert.equal(isTierPending(new Error('timeout')), false)
  assert.equal(isTierPending('Unable to load'), false)
  assert.equal(boardErrorText('Unable to load'), 'Unable to load')
})

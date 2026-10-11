import assert from 'node:assert/strict'
import { test } from 'node:test'
import { NFL_FREE_PREVIEW_ENABLED } from '../api/_dataAccess.js'
import { freeTierFaqAnswer, freeTierPreviewFeature } from '../src/freePreviewCopy.js'

test('the free-tier FAQ follows NFL_FREE_PREVIEW_ENABLED', () => {
  const answer = freeTierFaqAnswer()
  const feature = freeTierPreviewFeature()
  assert.match(answer, /top 3 lines/i)
  assert.match(answer, /KBO, WNBA/)
  assert.match(answer, /NHL/)
  if (NFL_FREE_PREVIEW_ENABLED) {
    assert.match(answer, /NFL/)
    assert.match(feature, /NFL/)
  } else {
    assert.doesNotMatch(answer, /NFL/)
    assert.doesNotMatch(feature, /NFL/)
  }
})

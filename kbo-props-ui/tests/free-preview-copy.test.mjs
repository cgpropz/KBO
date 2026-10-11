import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { test } from 'node:test'
import { fileURLToPath } from 'node:url'
import { NFL_FREE_PREVIEW_ENABLED } from '../api/_dataAccess.js'
import { freeTierFaqAnswer, freeTierPreviewFeature, freeTop3SectionState } from '../src/freePreviewCopy.js'

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

test('the free top 3 anchor stays when the NFL preview flag withholds NFL rows', () => {
  assert.equal(NFL_FREE_PREVIEW_ENABLED, false)
  const withOtherSports = freeTop3SectionState({
    kbo: { status: 'ready' },
    nfl: { status: 'empty' },
    wnba: { status: 'ready' },
    nhl: { status: 'empty' },
  })
  assert.equal(withOtherSports.showingRows, true)
  assert.equal(withOtherSports.anchorId, 'free-top-3')
  assert.deepEqual(withOtherSports.availableIds, ['kbo', 'wnba'])

  const nflOnly = freeTop3SectionState({
    kbo: { status: 'empty' },
    nfl: { status: 'empty' },
    wnba: { status: 'empty' },
    nhl: { status: 'empty' },
  })
  assert.equal(nflOnly.showingRows, false)
  assert.equal(nflOnly.anchorId, 'free-top-3')

  const source = readFileSync(join(fileURLToPath(new URL('.', import.meta.url)), '../src/FreePicksPreview.jsx'), 'utf8')
  assert.equal(source.split('id={anchorId}').length - 1, 2)
  assert.match(source, /id="free-picks"/)
})

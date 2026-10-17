import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { test } from 'node:test'
import { fileURLToPath } from 'node:url'
import { NFL_FREE_PREVIEW_ENABLED } from '../api/_dataAccess.js'
import { freePreviewBannerText, freeTierFaqAnswer, freeTierPreviewFeature, freeTop3SectionState } from '../src/freePreviewCopy.js'

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

test('the NFL preview banner follows NFL_FREE_PREVIEW_ENABLED and other sports stay on the top-3 line', () => {
  const paused = 'NFL free preview is paused. Sign up to see the full board.'
  const top3 = "Free preview: you're seeing the top 3 lines on each board."
  for (const sport of ['kbo', 'wnba', 'nba', 'nhl']) {
    assert.equal(freePreviewBannerText(sport, false), top3)
    assert.equal(freePreviewBannerText(sport, true), top3)
  }
  assert.equal(freePreviewBannerText('nfl', false), paused)
  assert.equal(freePreviewBannerText('nfl', true), top3)
  assert.equal(freePreviewBannerText('nfl'), NFL_FREE_PREVIEW_ENABLED ? top3 : paused)
  const app = readFileSync(join(fileURLToPath(new URL('.', import.meta.url)), '../src/App.jsx'), 'utf8')
  assert.match(app, /freePreviewBannerText\(visibleSport\)/)
  assert.match(app, /!user \|\| \(tierConfirmed && tier === 'free'\)/)
})

test('the phone lock card is full width in the unlayered mobile sheet', () => {
  const css = readFileSync(join(fileURLToPath(new URL('.', import.meta.url)), '../src/mobile.css'), 'utf8')
  const phone = css.slice(css.indexOf('@media (--phone-board)'))
  const rule = phone.slice(phone.indexOf('.nfl-lines-lock-card'))
  assert.match(rule, /width:\s*100%/)
  assert.match(rule, /max-width:\s*none/)
  assert.match(rule, /box-sizing:\s*border-box/)
})

test('the free top 3 anchor stays mounted when a board has no rows', () => {
  assert.equal(NFL_FREE_PREVIEW_ENABLED, true)
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

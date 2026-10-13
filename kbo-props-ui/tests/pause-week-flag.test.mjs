import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { join } from 'node:path'
import { pauseWeekEnabled } from '../src/pauseWindow.js'

test('pause week flag defaults off', () => {
  assert.equal(pauseWeekEnabled({}), false)
  assert.equal(pauseWeekEnabled({ VITE_PAUSE_WEEK_ENABLED: 'false' }), false)
  assert.equal(pauseWeekEnabled({ VITE_PAUSE_WEEK_ENABLED: 'true' }), true)
})

test('pause offer, link handling and FAQ are gated; cancel button is not', () => {
  const page = readFileSync(join(fileURLToPath(new URL('..', import.meta.url)), 'src/SubscriptionPage.jsx'), 'utf8')
  assert.match(page, /PAUSE_WEEK_ENABLED && !paused && \(/)
  assert.match(page, /PAUSE_WEEK_ENABLED && \(\s*<FaqItem\s*q="Can I pause/)
  assert.match(page, /setShowCancelConfirm\(true\)/)
})

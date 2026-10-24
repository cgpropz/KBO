// /pricing must not open a weekly Checkout Session on page load.
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { readFileSync } from 'node:fs'

const src = readFileSync(new URL('../src/SubscriptionPage.jsx', import.meta.url), 'utf8')

test('pricing does not prefetch a weekly Checkout Session on mount', () => {
  assert.equal(src.includes('prefetchWeeklyCheckoutUrl'), false)
  assert.equal(src.includes('weeklyHref'), false)
  assert.equal(src.includes('requestWeeklyCheckoutUrl'), false)
  const calls = src.match(/openWeeklyCheckoutUrl\(/g) || []
  assert.equal(calls.length, 1)
})

test('the weekly session is requested from the Buy click, after the age check', () => {
  const handler = src.slice(src.indexOf('const handleSubscribe'), src.indexOf('const requestMembership'))
  assert.ok(handler.includes("plan.id === 'weekly'"))
  assert.ok(handler.includes('openWeeklyCheckoutUrl('))
  const weekly = handler.slice(handler.indexOf("plan.id === 'weekly'"), handler.indexOf("plan.checkout === 'session'"))
  assert.ok(weekly.indexOf('if (weeklyBusy) return') < weekly.indexOf('requireAge()'))
  assert.ok(weekly.indexOf('requireAge()') < weekly.indexOf('openWeeklyCheckoutUrl('))
  assert.match(src, /disabled=\{tier\.id === 'free' \|\| \(!tier\.link && tier\.checkout !== 'session'\) \|\| \(tier\.id === 'weekly' && weeklyBusy\)\}/)
})

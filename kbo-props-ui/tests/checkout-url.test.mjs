// Unit tests for Stripe Payment Link query params built by buildCheckoutUrl.
// No network. Run: npm run test:api
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { STRIPE_LINKS } from '../src/pricingTiers.js'

const memory = new Map()
globalThis.localStorage = {
  getItem(key) { return memory.has(key) ? memory.get(key) : null },
  setItem(key, value) { memory.set(key, String(value)) },
  removeItem(key) { memory.delete(key) },
}

const { buildCheckoutUrl, captureAttribution } = await import('../src/tracking.js')

const USER = { id: 'user-1', email: 'buyer@example.com' }

function params(link, user) {
  return new URL(buildCheckoutUrl(link, user)).searchParams
}

test('weekly checkout prefills XWEEK and keeps email, client id, and UTMs', () => {
  memory.clear()
  captureAttribution('?utm_source=x&utm_medium=paid&utm_campaign=weekly_ads&utm_term=kbo&utm_content=start')
  const query = params(STRIPE_LINKS.weekly, USER)
  assert.equal(query.get('prefilled_promo_code'), 'XWEEK')
  assert.equal(query.get('client_reference_id'), 'user-1')
  assert.equal(query.get('prefilled_email'), 'buyer@example.com')
  assert.equal(query.get('utm_source'), 'x')
  assert.equal(query.get('utm_medium'), 'paid')
  assert.equal(query.get('utm_campaign'), 'weekly_ads')
  assert.equal(query.get('utm_term'), 'kbo')
  assert.equal(query.get('utm_content'), 'start')
})

test('logged-out weekly checkout still prefills XWEEK without identifiers', () => {
  memory.clear()
  const query = params(STRIPE_LINKS.weekly, null)
  assert.equal(query.get('prefilled_promo_code'), 'XWEEK')
  assert.equal(query.get('client_reference_id'), null)
  assert.equal(query.get('prefilled_email'), null)
  assert.equal(query.get('utm_source'), null)
})

test('monthly and lifetime checkouts do not get the weekly promo', () => {
  memory.clear()
  captureAttribution('?utm_source=x&utm_campaign=all_access')
  for (const link of [STRIPE_LINKS.monthly, STRIPE_LINKS.lifetime]) {
    const query = params(link, USER)
    assert.equal(query.get('prefilled_promo_code'), null)
    assert.equal(query.get('client_reference_id'), 'user-1')
    assert.equal(query.get('prefilled_email'), 'buyer@example.com')
    assert.equal(query.get('utm_source'), 'x')
    assert.equal(query.get('utm_campaign'), 'all_access')
  }
})

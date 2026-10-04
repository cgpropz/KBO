// Unit tests for Stripe checkout URLs built by tracking.js.
// No network. Run: npm run test:api
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { STRIPE_LINKS, TIERS } from '../src/pricingTiers.js'

const memory = new Map()
globalThis.localStorage = {
  getItem(key) { return memory.has(key) ? memory.get(key) : null },
  setItem(key, value) { memory.set(key, String(value)) },
  removeItem(key) { memory.delete(key) },
}

const { buildCheckoutUrl, captureAttribution, requestWeeklyCheckoutUrl, resolvePlanCheckoutUrl, prefetchWeeklyCheckoutUrl, weeklyCheckoutHref } = await import('../src/tracking.js')

const USER = { id: 'user-1', email: 'buyer@example.com' }
const SESSION_URL = 'https://checkout.stripe.com/c/pay/cs_live_weeklyxweek'

function params(link, user) {
  return new URL(buildCheckoutUrl(link, user)).searchParams
}

function jsonResponse(body, ok = true) {
  return { ok, async json() { return body } }
}

test('weekly payment link keeps email, client id, and UTMs and does not prefill XWEEK', () => {
  memory.clear()
  captureAttribution('?utm_source=x&utm_medium=paid&utm_campaign=weekly_ads&utm_term=kbo&utm_content=start')
  const query = params(STRIPE_LINKS.weekly, USER)
  assert.equal(query.get('prefilled_promo_code'), null)
  assert.equal(query.get('client_reference_id'), 'user-1')
  assert.equal(query.get('prefilled_email'), 'buyer@example.com')
  assert.equal(query.get('utm_source'), 'x')
  assert.equal(query.get('utm_medium'), 'paid')
  assert.equal(query.get('utm_campaign'), 'weekly_ads')
  assert.equal(query.get('utm_term'), 'kbo')
  assert.equal(query.get('utm_content'), 'start')
})

test('logged-out weekly payment link has no promo and no identifiers', () => {
  memory.clear()
  const query = params(STRIPE_LINKS.weekly, null)
  assert.equal(query.get('prefilled_promo_code'), null)
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

test('requestWeeklyCheckoutUrl posts UTMs and the bearer token and returns only a Checkout Session URL', async () => {
  memory.clear()
  captureAttribution('?utm_source=x&utm_medium=paid&utm_campaign=weekly_ads&utm_term=kbo&utm_content=start')
  let seen
  const url = await requestWeeklyCheckoutUrl({
    token: 'jwt-1',
    fetchImpl: async (path, init) => {
      seen = { path, init }
      return jsonResponse({ url: SESSION_URL, id: 'cs_live_secret' })
    },
  })
  assert.equal(url, SESSION_URL)
  assert.equal(seen.path, '/api/weekly-checkout')
  assert.equal(seen.init.method, 'POST')
  assert.equal(seen.init.headers.Authorization, 'Bearer jwt-1')
  assert.equal(seen.init.headers['Content-Type'], 'application/json')
  assert.deepEqual(JSON.parse(seen.init.body), {
    utm_source: 'x',
    utm_medium: 'paid',
    utm_campaign: 'weekly_ads',
    utm_term: 'kbo',
    utm_content: 'start',
  })
})

test('requestWeeklyCheckoutUrl rejects failed responses and non-checkout hosts', async () => {
  await assert.rejects(() => requestWeeklyCheckoutUrl({
    utm: {},
    fetchImpl: async () => jsonResponse({}, false),
  }))
  await assert.rejects(() => requestWeeklyCheckoutUrl({
    utm: {},
    fetchImpl: async () => jsonResponse({ url: 'https://buy.stripe.com/00wcN7gkD7Ui8ng6z65Ne08?prefilled_promo_code=XWEEK' }),
  }))
  await assert.rejects(() => requestWeeklyCheckoutUrl({
    utm: {},
    fetchImpl: async () => jsonResponse({ url: 'https://checkout.stripe.com.evil.example/c/pay/cs_live_x' }),
  }))
})

test('resolvePlanCheckoutUrl sends weekly to the session and falls back to the weekly link without a promo', async () => {
  memory.clear()
  const weekly = TIERS.find((t) => t.id === 'weekly')
  const ok = await resolvePlanCheckoutUrl(weekly, USER, {
    token: 'jwt-1',
    fetchImpl: async () => jsonResponse({ url: SESSION_URL }),
  })
  assert.equal(ok, SESSION_URL)

  const fallback = await resolvePlanCheckoutUrl(weekly, USER, {
    token: 'jwt-1',
    fetchImpl: async () => { throw new Error('down') },
  })
  const query = new URL(fallback).searchParams
  assert.equal(fallback.startsWith(STRIPE_LINKS.weekly), true)
  assert.equal(query.get('prefilled_promo_code'), null)
  assert.equal(query.get('client_reference_id'), 'user-1')
  assert.equal(query.get('prefilled_email'), 'buyer@example.com')
})

test('weeklyCheckoutHref navigates immediately and upgrades to the session once it is ready', async () => {
  memory.clear()
  const before = weeklyCheckoutHref(USER, 'token-href')
  assert.equal(before.startsWith(STRIPE_LINKS.weekly), true)
  assert.equal(new URL(before).searchParams.get('prefilled_promo_code'), null)
  assert.equal(new URL(before).searchParams.get('client_reference_id'), 'user-1')

  const got = await prefetchWeeklyCheckoutUrl({
    token: 'token-href',
    utm: {},
    fetchImpl: async () => jsonResponse({ url: SESSION_URL }),
  })
  assert.equal(got, SESSION_URL)
  assert.equal(weeklyCheckoutHref(USER, 'token-href'), SESSION_URL)
})

test('a failed weekly prefetch leaves the payment link without a promo code', async () => {
  memory.clear()
  await assert.rejects(() => prefetchWeeklyCheckoutUrl({
    token: 'token-fail',
    utm: {},
    fetchImpl: async () => jsonResponse({}, false),
  }))
  const href = weeklyCheckoutHref(null, 'token-fail')
  assert.equal(href.startsWith(STRIPE_LINKS.weekly), true)
  assert.equal(new URL(href).searchParams.get('prefilled_promo_code'), null)
})

test('resolvePlanCheckoutUrl keeps monthly on its payment link', async () => {
  memory.clear()
  const monthly = TIERS.find((t) => t.id === 'combined')
  let called = false
  const url = await resolvePlanCheckoutUrl(monthly, USER, {
    fetchImpl: async () => {
      called = true
      return jsonResponse({ url: SESSION_URL })
    },
  })
  assert.equal(called, false)
  assert.equal(url.startsWith(STRIPE_LINKS.monthly), true)
  const query = new URL(url).searchParams
  assert.equal(query.get('prefilled_promo_code'), null)
  assert.equal(query.get('client_reference_id'), 'user-1')
  assert.equal(query.get('prefilled_email'), 'buyer@example.com')
})

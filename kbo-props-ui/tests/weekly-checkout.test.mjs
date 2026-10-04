// Unit tests for POST /api/weekly-checkout with a mocked Stripe client.
// No network, no credentials. Run: npm run test:api
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { handleWeeklyCheckoutRequest } from '../api/weekly-checkout.js'
import { WEEKLY_PRICE_ID, XWEEK_PROMOTION_CODE_ID } from '../src/pricingTiers.js'

const SESSION_URL = 'https://checkout.stripe.com/c/pay/cs_live_weeklyxweek'
const SUCCESS_URL = 'https://www.cgpropz.com/?checkout=success&session_id={CHECKOUT_SESSION_ID}'

function mockRes() {
  return {
    statusCode: 200, headers: {}, body: undefined,
    setHeader(k, v) { this.headers[k.toLowerCase()] = v },
    status(code) { this.statusCode = code; return this },
    json(obj) { this.body = obj; return this },
  }
}

function mockStripe(result = { url: SESSION_URL, id: 'cs_live_secret', customer: 'cus_secret' }, calls = []) {
  return {
    calls,
    checkout: {
      sessions: {
        async create(params) {
          calls.push(params)
          if (result instanceof Error) throw result
          return result
        },
      },
    },
  }
}

async function call(body, { method = 'POST', stripe, user, authorization, authenticate } = {}) {
  const res = mockRes()
  const headers = {}
  if (authorization) headers.authorization = authorization
  await handleWeeklyCheckoutRequest(
    { method, body, headers },
    res,
    { stripe, user, authenticate },
  )
  return res
}

test('creates the existing weekly price with XWEEK applied and returns only the url', async () => {
  const calls = []
  const stripe = mockStripe(undefined, calls)
  const res = await call({
    utm_source: 'x',
    utm_medium: 'paid',
    utm_campaign: 'weekly_ads',
    utm_term: 'kbo',
    utm_content: 'start',
    price: 'price_attacker',
    promotion_code: 'promo_attacker',
    cg_plan: 'lifetime',
  }, { stripe, user: null })

  assert.equal(res.statusCode, 200)
  assert.equal(res.headers['cache-control'], 'private, no-store, max-age=0')
  assert.deepEqual(res.body, { url: SESSION_URL })
  assert.equal(calls.length, 1)
  const params = calls[0]
  assert.equal(params.mode, 'subscription')
  assert.deepEqual(params.line_items, [{ price: WEEKLY_PRICE_ID, quantity: 1 }])
  assert.deepEqual(params.discounts, [{ promotion_code: XWEEK_PROMOTION_CODE_ID }])
  assert.equal(params.success_url, SUCCESS_URL)
  assert.equal(params.cancel_url, 'https://www.cgpropz.com/')
  assert.deepEqual(params.automatic_tax, { enabled: false })
  assert.equal(params.billing_address_collection, 'auto')
  assert.equal(params.phone_number_collection, undefined)
  assert.equal(params.metadata.cg_plan, 'weekly')
  assert.equal(params.metadata.utm_source, 'x')
  assert.equal(params.metadata.utm_medium, 'paid')
  assert.equal(params.metadata.utm_campaign, 'weekly_ads')
  assert.equal(params.metadata.utm_term, 'kbo')
  assert.equal(params.metadata.utm_content, 'start')
  assert.equal(params.client_reference_id, undefined)
  assert.equal(params.customer_email, undefined)
  assert.match(params.integration_identifier, /^cgpropz_weekly_[a-z]{8}$/)
  assert.equal(JSON.stringify(params).includes('price_attacker'), false)
  assert.equal(JSON.stringify(params).includes('promo_attacker'), false)
  assert.equal(JSON.stringify(params).includes('lifetime'), false)
})

test('drops invalid UTM values and keeps a logged-in buyer on the session', async () => {
  const calls = []
  const res = await call({
    utm_source: 'x',
    utm_campaign: 'has space',
    utm_content: 'x'.repeat(151),
    utm_medium: 'paid!',
  }, {
    stripe: mockStripe(undefined, calls),
    user: { id: 'user_123', email: 'buyer@example.com' },
  })
  assert.equal(res.statusCode, 200)
  assert.deepEqual(res.body, { url: SESSION_URL })
  const params = calls[0]
  assert.equal(params.client_reference_id, 'user_123')
  assert.equal(params.customer_email, 'buyer@example.com')
  assert.equal(params.metadata.utm_source, 'x')
  assert.equal(params.metadata.utm_campaign, undefined)
  assert.equal(params.metadata.utm_content, undefined)
  assert.equal(params.metadata.utm_medium, undefined)
  assert.equal(params.metadata.cg_plan, 'weekly')
})

test('omits a buyer id or email Stripe would reject', async () => {
  const calls = []
  await call({}, {
    stripe: mockStripe(undefined, calls),
    user: { id: 'not a uuid', email: 'not-an-email' },
  })
  assert.equal(calls[0].client_reference_id, undefined)
  assert.equal(calls[0].customer_email, undefined)
})

test('a missing or invalid token checks out as a guest', async () => {
  const calls = []
  const stripe = mockStripe(undefined, calls)
  const guest = await call({}, { stripe, authorization: 'Bearer bad-token', authenticate: async () => null })
  assert.equal(guest.statusCode, 200)
  assert.equal(calls[0].client_reference_id, undefined)
  assert.equal(calls[0].customer_email, undefined)

  const signedIn = await call({}, {
    stripe,
    authorization: 'Bearer good-token',
    authenticate: async (jwt) => (jwt === 'good-token' ? { id: 'user-9', email: 'fan@example.com' } : null),
  })
  assert.equal(signedIn.statusCode, 200)
  assert.equal(calls[1].client_reference_id, 'user-9')
  assert.equal(calls[1].customer_email, 'fan@example.com')
})

test('only POST is allowed', async () => {
  const res = await call({}, { method: 'GET', stripe: mockStripe() })
  assert.equal(res.statusCode, 405)
  assert.equal(res.headers.allow, 'POST')
})

test('returns 503 when Stripe is not configured', async () => {
  const saved = process.env.STRIPE_SECRET_KEY
  delete process.env.STRIPE_SECRET_KEY
  try {
    const res = await call({}, { user: null })
    assert.equal(res.statusCode, 503)
  } finally {
    if (saved === undefined) delete process.env.STRIPE_SECRET_KEY
    else process.env.STRIPE_SECRET_KEY = saved
  }
})

test('returns 502 when Stripe throws or the session URL is not hosted checkout', async () => {
  const thrown = await call({}, { stripe: mockStripe(new Error('boom')), user: null })
  assert.equal(thrown.statusCode, 502)
  assert.deepEqual(thrown.body, { error: 'Checkout unavailable' })

  const badUrl = await call({}, { stripe: mockStripe({ url: 'https://buy.stripe.com/not-a-session' }), user: null })
  assert.equal(badUrl.statusCode, 502)
})

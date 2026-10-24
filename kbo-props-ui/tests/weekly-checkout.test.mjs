// Unit tests for POST /api/weekly-checkout with a mocked Stripe client.
// No network, no credentials. Run: npm run test:api
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { handleWeeklyCheckoutRequest } from '../api/_weeklyCheckout.js'
import { WEEKLY_PRICE_ID, XWEEK_PROMOTION_CODE_ID } from '../src/pricingTiers.js'

const SESSION_URL = 'https://checkout.stripe.com/c/pay/cs_live_weeklyxweek'
const SUCCESS_URL = 'https://www.cgpropz.com/?checkout=success&session_id={CHECKOUT_SESSION_ID}'
const BROWSER_UA = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 Twitter for iPhone'

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

async function call(body, { method = 'POST', stripe, user, authorization, authenticate, headers = {}, now } = {}) {
  const res = mockRes()
  const reqHeaders = { 'user-agent': BROWSER_UA, ...headers }
  if (authorization) reqHeaders.authorization = authorization
  await handleWeeklyCheckoutRequest(
    { method, body, headers: reqHeaders },
    res,
    { stripe, user, authenticate, now },
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
  assert.equal(params.metadata.price_id, WEEKLY_PRICE_ID)
  assert.equal(params.metadata.xweek, '1')
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

test('a returning customer whose XWEEK code is rejected still gets a payable weekly checkout', async () => {
  const calls = []
  const promoError = new Error('This promotion code cannot be redeemed because the associated customer has prior transactions.')
  let n = 0
  const stripe = {
    customers: { async list() { return { data: [{ id: 'cus_existing', email: 'buyer@example.com' }] } } },
    checkout: { sessions: { async create(params) {
      calls.push(structuredClone(params))
      n += 1
      if (n === 1) throw promoError
      return { url: SESSION_URL }
    } } },
  }
  const res = await call({}, { stripe, user: { id: 'user_123', email: 'buyer@example.com' } })
  assert.equal(res.statusCode, 200)
  assert.deepEqual(res.body, { url: SESSION_URL })
  assert.equal(calls.length, 2)
  assert.equal(calls[0].customer, 'cus_existing')
  assert.deepEqual(calls[0].discounts, [{ promotion_code: XWEEK_PROMOTION_CODE_ID }])
  assert.equal(calls[0].customer_email, undefined)
  assert.equal(calls[1].customer, 'cus_existing')
  assert.equal(calls[1].discounts, undefined)
  assert.equal(calls[1].metadata.xweek, '0')
  assert.equal(calls[1].metadata.price_id, WEEKLY_PRICE_ID)
  assert.equal(calls[1].line_items[0].price, WEEKLY_PRICE_ID)
  assert.equal(calls[1].client_reference_id, 'user_123')
})

test('crawlers, empty user agents, and prefetch do not create a session', async () => {
  for (const ua of ['Twitterbot/1.0', 'Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)', '']) {
    const calls = []
    const res = await call({}, { stripe: mockStripe(undefined, calls), headers: { 'user-agent': ua } })
    assert.equal(res.statusCode, 403, ua || '(empty)')
    assert.equal(calls.length, 0, ua || '(empty)')
  }
  const calls = []
  const prefetch = await call({}, {
    stripe: mockStripe(undefined, calls),
    headers: { 'user-agent': BROWSER_UA, 'sec-purpose': 'prefetch' },
  })
  assert.equal(prefetch.statusCode, 403)
  assert.equal(calls.length, 0)
})

function customerStripe(calls, openSessions, { create } = {}) {
  return {
    customers: { async list() { return { data: [{ id: 'cus_existing', email: 'buyer@example.com' }] } } },
    checkout: { sessions: {
      async list(params) { calls.push(['list', params]); return { data: openSessions } },
      async create(params) {
        calls.push(['create', params])
        if (create) return create(params)
        return { url: SESSION_URL }
      },
    } },
  }
}

const NOW_MS = 1_800_000_000_000
const NOW_S = NOW_MS / 1000
const OPEN_URL = 'https://checkout.stripe.com/c/pay/cs_live_openweekly'
const buyer = { id: 'user_123', email: 'buyer@example.com' }

function openWeekly(xweek, extras = {}) {
  return {
    url: OPEN_URL,
    mode: 'subscription',
    expires_at: NOW_S + 20 * 3600,
    metadata: { cg_plan: 'weekly', price_id: WEEKLY_PRICE_ID, xweek },
    ...extras,
  }
}

test('an open XWEEK session for the same customer and weekly price is reused', async () => {
  const calls = []
  const stripe = customerStripe(calls, [openWeekly('1')])
  const res = await call({}, { stripe, user: buyer, now: () => NOW_MS })
  assert.equal(res.statusCode, 200)
  assert.deepEqual(res.body, { url: OPEN_URL })
  assert.deepEqual(calls.map((c) => c[0]), ['list'])
  assert.deepEqual(calls[0][1], { customer: 'cus_existing', status: 'open', limit: 20 })
})

test('a full-price open session is not reused when XWEEK still applies', async () => {
  const calls = []
  const stripe = customerStripe(calls, [openWeekly('0')])
  const res = await call({}, { stripe, user: buyer, now: () => NOW_MS })
  assert.equal(res.body.url, SESSION_URL)
  assert.deepEqual(calls.map((c) => c[0]), ['list', 'create'])
  assert.deepEqual(calls[1][1].discounts, [{ promotion_code: XWEEK_PROMOTION_CODE_ID }])
  assert.equal(calls[1][1].line_items[0].price, WEEKLY_PRICE_ID)
  assert.equal(calls[1][1].metadata.xweek, '1')
})

test('a rejected XWEEK code reuses an open full-price session instead of creating another', async () => {
  const calls = []
  const promoError = new Error('This promotion code cannot be redeemed because the associated customer has prior transactions.')
  const stripe = customerStripe(calls, [openWeekly('0')], {
    create() { throw promoError },
  })
  const res = await call({}, { stripe, user: buyer, now: () => NOW_MS })
  assert.equal(res.statusCode, 200)
  assert.deepEqual(res.body, { url: OPEN_URL })
  assert.deepEqual(calls.map((c) => c[0]), ['list', 'create'])
})

test('an open session that is about to expire, for another price, or missing the price id is not reused', async () => {
  const calls = []
  const stripe = customerStripe(calls, [
    openWeekly('1', { expires_at: NOW_S + 10 * 60 }),
    openWeekly('1', { metadata: { cg_plan: 'weekly', price_id: 'price_old', xweek: '1' } }),
    { url: OPEN_URL, mode: 'subscription', expires_at: NOW_S + 20 * 3600, metadata: { cg_plan: 'weekly', xweek: '1' } },
  ])
  const res = await call({}, { stripe, user: buyer, now: () => NOW_MS })
  assert.equal(res.body.url, SESSION_URL)
  assert.deepEqual(calls.map((c) => c[0]), ['list', 'create'])
})

test('guests do not look up open sessions', async () => {
  const calls = []
  const stripe = customerStripe(calls, [openWeekly('1')])
  const res = await call({}, { stripe, user: null, now: () => NOW_MS })
  assert.equal(res.statusCode, 200)
  assert.equal(res.body.url, SESSION_URL)
  assert.deepEqual(calls.map((c) => c[0]), ['create'])
})

test('returns 502 when Stripe throws or the session URL is not hosted checkout', async () => {
  const thrown = await call({}, { stripe: mockStripe(new Error('boom')), user: null })
  assert.equal(thrown.statusCode, 502)
  assert.deepEqual(thrown.body, { error: 'Checkout unavailable' })

  const badUrl = await call({}, { stripe: mockStripe({ url: 'https://buy.stripe.com/not-a-session' }), user: null })
  assert.equal(badUrl.statusCode, 502)
})

// Discord-only Checkout Sessions. No network, no credentials.
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { handleDiscordCheckoutRequest, isAutomatedClient } from '../api/_discordCheckout.js'

const SESSION_URL = 'https://checkout.stripe.com/c/pay/cs_test_discord'
const PRICE = 'price_discordWeeklyTest'
const ENV = { STRIPE_PRICE_DISCORD_WEEKLY: PRICE, STRIPE_PRICE_DISCORD_MONTHLY: 'price_discordMonthlyTest' }

function mockRes() {
  return {
    statusCode: 200, headers: {}, body: undefined,
    setHeader(k, v) { this.headers[k.toLowerCase()] = v },
    status(code) { this.statusCode = code; return this },
    json(obj) { this.body = obj; return this },
  }
}

function mockStripe(calls) {
  return {
    checkout: {
      sessions: {
        async create(params) {
          calls.push(params)
          return { url: SESSION_URL, id: 'cs_test_discord' }
        },
      },
    },
  }
}

const BROWSER_UA = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 Twitter for iPhone'

async function call(body, { method = 'POST', env = ENV, user = null, stripe, headers = { 'user-agent': BROWSER_UA }, now } = {}) {
  const calls = []
  const res = mockRes()
  await handleDiscordCheckoutRequest(
    { method, body, headers },
    res,
    { env, user, now, stripe: stripe === undefined ? mockStripe(calls) : stripe },
  )
  return { res, calls }
}

test('creates a discord weekly subscription and ignores a client-supplied price', async () => {
  const { res, calls } = await call({
    plan: 'weekly',
    price: 'price_attacker',
    cg_plan: 'lifetime',
    utm_source: 'x',
    utm_campaign: 'bad campaign',
  }, { user: { id: 'user_123', email: 'buyer@example.com' } })

  assert.equal(res.statusCode, 200)
  assert.deepEqual(res.body, { url: SESSION_URL })
  assert.equal(calls.length, 1)
  const params = calls[0]
  assert.equal(params.mode, 'subscription')
  assert.deepEqual(params.line_items, [{ price: PRICE, quantity: 1 }])
  assert.equal(params.metadata.cg_plan, 'discord_weekly')
  assert.equal(params.metadata.tier, 'discord_only')
  assert.deepEqual(params.subscription_data, { metadata: { cg_plan: 'discord_weekly', tier: 'discord_only' } })
  assert.equal(params.metadata.utm_source, 'x')
  assert.equal(params.metadata.utm_campaign, undefined)
  assert.equal(params.client_reference_id, 'user_123')
  assert.equal(params.customer_email, 'buyer@example.com')
  assert.equal(params.payment_method_types, undefined)
  assert.deepEqual(params.automatic_tax, { enabled: false })
  assert.equal(params.success_url, 'https://www.cgpropz.com/?checkout=success&session_id={CHECKOUT_SESSION_ID}')
  assert.match(params.integration_identifier, /^cgpropz_discord_[a-z]{8}$/)
  assert.equal(JSON.stringify(params).includes('price_attacker'), false)
  assert.equal(JSON.stringify(params).includes('lifetime'), false)
})

test('monthly uses the monthly price id', async () => {
  const { calls } = await call({ plan: 'monthly' })
  assert.equal(calls[0].line_items[0].price, 'price_discordMonthlyTest')
  assert.equal(calls[0].metadata.cg_plan, 'discord_monthly')
  assert.equal(calls[0].metadata.tier, 'discord_only')
})

test('falls back to the live discord prices when env vars are empty or invalid', async () => {
  const weekly = await call({ plan: 'weekly' }, { env: {} })
  assert.equal(weekly.res.statusCode, 200)
  assert.equal(weekly.calls[0].line_items[0].price, 'price_1UP73vPwL0k9PEMvDVDtXWzq')
  assert.equal(weekly.calls[0].metadata.tier, 'discord_only')
  assert.equal(weekly.calls[0].subscription_data.metadata.cg_plan, 'discord_weekly')

  const monthly = await call({ plan: 'monthly' }, { env: { STRIPE_PRICE_DISCORD_MONTHLY: 'not-a-price' } })
  assert.equal(monthly.res.statusCode, 200)
  assert.equal(monthly.calls[0].line_items[0].price, 'price_1UP73wPwL0k9PEMv5Pobm6nU')
})

test('refuses an unknown plan instead of charging all-access', async () => {
  const { res, calls } = await call({ plan: 'lifetime' })
  assert.equal(res.statusCode, 503)
  assert.equal(calls.length, 0)
})

test('only POST is allowed', async () => {
  const { res } = await call({}, { method: 'GET', stripe: null })
  assert.equal(res.statusCode, 405)
})

// --- Sessions only for real Buy clicks ---------------------------------

test('crawlers, link previews, headless browsers and prefetch get no session', async () => {
  const agents = [
    'Mozilla/5.0 AppleWebKit/537.36 (KHTML, like Gecko; compatible; Googlebot/2.1; +http://www.google.com/bot.html) Chrome/130 Safari/537.36',
    'Mozilla/5.0 (compatible; Discordbot/2.0; +https://discordapp.com)',
    'Twitterbot/1.0',
    'facebookexternalhit/1.1 (+http://www.facebook.com/externalhit_uatext.php)',
    'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) HeadlessChrome/130.0 Safari/537.36',
    'WhatsApp/2.23.20.0',
    'curl/8.5.0',
    '',
  ]
  for (const ua of agents) {
    const { res, calls } = await call({ plan: 'weekly' }, { headers: { 'user-agent': ua } })
    assert.equal(res.statusCode, 403, ua)
    assert.equal(calls.length, 0, ua)
  }
  const prefetch = await call({ plan: 'weekly' }, { headers: { 'user-agent': BROWSER_UA, 'sec-purpose': 'prefetch' } })
  assert.equal(prefetch.res.statusCode, 403)
  assert.equal(prefetch.calls.length, 0)
})

test('real phone and desktop browsers still check out', () => {
  for (const ua of [
    BROWSER_UA,
    'Mozilla/5.0 (Linux; Android 12; CUBOT X30 Build/SP1A) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120 Mobile Safari/537.36',
    'Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Mobile Safari/537.36 [FB_IAB/FB4A;FBAV/400.0;]',
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36 Edg/130.0',
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Safari/605.1.15',
  ]) assert.equal(isAutomatedClient({ 'user-agent': ua }), false, ua)
})

function customerStripe(calls, openSessions) {
  return {
    customers: { async list() { return { data: [{ id: 'cus_1', email: 'buyer@example.com', created: 1 }] } } },
    checkout: {
      sessions: {
        async list(params) { calls.push(['list', params]); return { data: openSessions } },
        async create(params) { calls.push(['create', params]); return { url: SESSION_URL, id: 'cs_new' } },
      },
    },
  }
}

const NOW_MS = 1_800_000_000_000
const NOW_S = NOW_MS / 1000
const OPEN_URL = 'https://checkout.stripe.com/c/pay/cs_live_open'
const buyer = { id: 'user_123', email: 'buyer@example.com' }

test('a signed-in customer gets their open session for the same plan back', async () => {
  const calls = []
  const stripe = customerStripe(calls, [
    { url: 'https://checkout.stripe.com/c/pay/other', mode: 'subscription', metadata: { cg_plan: 'discord_monthly', tier: 'discord_only' }, expires_at: NOW_S + 20 * 3600 },
    { url: OPEN_URL, mode: 'subscription', metadata: { cg_plan: 'discord_weekly', tier: 'discord_only' }, expires_at: NOW_S + 20 * 3600 },
  ])
  const { res } = await call({ plan: 'weekly' }, { user: buyer, stripe, now: () => NOW_MS })
  assert.equal(res.statusCode, 200)
  assert.deepEqual(res.body, { url: OPEN_URL })
  assert.deepEqual(calls.map((c) => c[0]), ['list'])
  assert.deepEqual(calls[0][1], { customer: 'cus_1', status: 'open', limit: 20 })
})

test('an open session that is about to expire, or for another plan, is not reused', async () => {
  const calls = []
  const stripe = customerStripe(calls, [
    { url: OPEN_URL, mode: 'subscription', metadata: { cg_plan: 'discord_weekly', tier: 'discord_only' }, expires_at: NOW_S + 10 * 60 },
    { url: OPEN_URL, mode: 'subscription', metadata: { cg_plan: 'weekly', tier: 'combined' }, expires_at: NOW_S + 20 * 3600 },
  ])
  const { res } = await call({ plan: 'weekly' }, { user: buyer, stripe, now: () => NOW_MS })
  assert.deepEqual(res.body, { url: SESSION_URL })
  assert.deepEqual(calls.map((c) => c[0]), ['list', 'create'])
  assert.equal(calls[1][1].customer, 'cus_1')
})

test('a failed lookup still creates a session', async () => {
  const calls = []
  const stripe = customerStripe(calls, [])
  stripe.checkout.sessions.list = async () => { throw new Error('rate limited') }
  const { res } = await call({ plan: 'monthly' }, { user: buyer, stripe, now: () => NOW_MS })
  assert.equal(res.statusCode, 200)
  assert.deepEqual(res.body, { url: SESSION_URL })
})

test('guests skip the lookup and get a fresh session', async () => {
  const calls = []
  const stripe = customerStripe(calls, [])
  const { res } = await call({ plan: 'weekly' }, { stripe })
  assert.equal(res.statusCode, 200)
  assert.deepEqual(calls.map((c) => c[0]), ['create'])
})

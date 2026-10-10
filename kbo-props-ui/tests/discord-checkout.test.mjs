// Discord-only Checkout Sessions. No network, no credentials.
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { handleDiscordCheckoutRequest } from '../api/_discordCheckout.js'

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

async function call(body, { method = 'POST', env = ENV, user = null, stripe } = {}) {
  const calls = []
  const res = mockRes()
  await handleDiscordCheckoutRequest(
    { method, body, headers: {} },
    res,
    { env, user, stripe: stripe === undefined ? mockStripe(calls) : stripe },
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

// Unit tests for GET /api/checkout-session with a mocked Stripe client.
// No network, no credentials. Run: npm run test:api
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { handleCheckoutSessionRequest } from '../api/checkout-session.js'
import { planForAmount } from '../api/_stripeTier.js'

const VALID_ID = 'cs_live_a1B2c3D4e5F6g7H8i9J0'

function mockRes() {
  return {
    statusCode: 200, headers: {}, body: undefined,
    setHeader(k, v) { this.headers[k.toLowerCase()] = v },
    status(code) { this.statusCode = code; return this },
    json(obj) { this.body = obj; return this },
  }
}

function mockStripe(sessions, calls = []) {
  return {
    calls,
    checkout: {
      sessions: {
        async retrieve(id) {
          calls.push(id)
          if (id in sessions) return structuredClone(sessions[id])
          const err = new Error(`No such checkout.session: '${id}'`)
          err.statusCode = 404
          err.code = 'resource_missing'
          throw err
        },
      },
    },
  }
}

// A realistic session object, including PII that must never be echoed back.
function session(overrides = {}) {
  return {
    id: VALID_ID,
    object: 'checkout.session',
    status: 'complete',
    payment_status: 'paid',
    amount_total: 999,
    currency: 'usd',
    client_reference_id: 'user-uuid-123',
    customer: 'cus_123',
    customer_email: 'buyer@example.com',
    customer_details: { email: 'buyer@example.com', name: 'Jane Buyer', address: { country: 'US' } },
    ...overrides,
  }
}

async function call(sessionId, stripe, method = 'GET') {
  const res = mockRes()
  await handleCheckoutSessionRequest({ method, query: { session_id: sessionId }, headers: {} }, res, stripe)
  return res
}

test('returns only amount, currency and plan for a paid session', async () => {
  const stripe = mockStripe({ [VALID_ID]: session() })
  const res = await call(VALID_ID, stripe)
  assert.equal(res.statusCode, 200)
  assert.equal(res.headers['cache-control'], 'private, no-store, max-age=0')
  assert.deepEqual(res.body, { paid: true, amount: 9.99, currency: 'USD', plan: 'weekly' })
  const text = JSON.stringify(res.body)
  for (const pii of ['buyer@example.com', 'Jane', 'cus_123', 'user-uuid-123']) assert.ok(!text.includes(pii), pii)
})

test('maps every current plan amount to its plan and value', async () => {
  const cases = [[999, 9.99, 'weekly'], [2999, 29.99, 'monthly'], [9999, 99.99, 'lifetime'], [1999, 19.99, 'other']]
  for (const [cents, amount, plan] of cases) {
    const res = await call(VALID_ID, mockStripe({ [VALID_ID]: session({ amount_total: cents }) }))
    assert.equal(res.body.amount, amount)
    assert.equal(res.body.plan, plan)
    assert.equal(planForAmount(cents), plan)
  }
})

test('unpaid or incomplete sessions report paid:false', async () => {
  for (const overrides of [{ payment_status: 'unpaid' }, { status: 'open' }, { status: 'expired', payment_status: 'unpaid' }]) {
    const res = await call(VALID_ID, mockStripe({ [VALID_ID]: session(overrides) }))
    assert.equal(res.statusCode, 200)
    assert.equal(res.body.paid, false, JSON.stringify(overrides))
  }
})

test('malformed session ids are rejected without calling Stripe', async () => {
  const calls = []
  const stripe = mockStripe({}, calls)
  for (const id of ['', 'abc', 'cs_live_', 'pi_123456789012345', 'cs_live_abc/../x', 'cs_live_abc123456789?x=1', 'cs_prod_abcdefghijklmnop']) {
    const res = await call(id, stripe)
    assert.equal(res.statusCode, 400, id)
  }
  assert.equal(calls.length, 0)
})

test('unknown session returns 404; Stripe errors return 502', async () => {
  const missing = await call('cs_test_doesnotexist12345', mockStripe({}))
  assert.equal(missing.statusCode, 404)

  const broken = { checkout: { sessions: { async retrieve() { throw new Error('boom') } } } }
  const res = await call(VALID_ID, broken)
  assert.equal(res.statusCode, 502)
  assert.ok(!('amount' in res.body))
})

test('only GET is allowed', async () => {
  const res = await call(VALID_ID, mockStripe({ [VALID_ID]: session() }), 'POST')
  assert.equal(res.statusCode, 405)
  assert.equal(res.headers.allow, 'GET')
})

test('returns 503 when no Stripe key is configured', async () => {
  const saved = process.env.STRIPE_SECRET_KEY
  delete process.env.STRIPE_SECRET_KEY
  try {
    const res = await call(VALID_ID)
    assert.equal(res.statusCode, 503)
  } finally {
    if (saved !== undefined) process.env.STRIPE_SECRET_KEY = saved
  }
})

import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  FOUNDERS_CAP,
  FOUNDERS_DEADLINE_MS,
  foundersOfferState,
  isFoundersSession,
} from '../src/foundersOffer.js'
import { handleOfferCheckoutRequest } from '../api/_offerCheckout.js'
import { activeFoundersPriceId, activeLifetimePriceId } from '../api/_stripeTier.js'

const OPEN = Date.parse('2026-10-12T16:00:00.000Z')
const LAST_SECOND = Date.parse('2026-10-18T23:59:59-04:00')
const DEADLINE = Date.parse('2026-10-19T00:00:00-04:00')
const FOUNDERS = 'price_1THZjaPwL0k9PEMvARtuGG1F'
const LIFETIME = 'price_1UPJ78PwL0k9PEMvnZPU3k5a'

function paid(id, extras = {}) {
  return {
    id,
    status: 'complete',
    payment_status: 'paid',
    created: Math.floor(OPEN / 1000),
    ...extras,
  }
}

test('founders offer closes at the end of 18 Oct 2026 ET and at 25 buyers', () => {
  assert.equal(DEADLINE, FOUNDERS_DEADLINE_MS)
  assert.equal(foundersOfferState({ now: LAST_SECOND, sold: 0 }).open, true)
  assert.equal(foundersOfferState({ now: DEADLINE, sold: 0 }).open, false)
  assert.equal(foundersOfferState({ now: DEADLINE, sold: 0 }).reason, 'expired')
  assert.equal(foundersOfferState({ now: OPEN, sold: FOUNDERS_CAP - 1 }).open, true)
  assert.equal(foundersOfferState({ now: OPEN, sold: FOUNDERS_CAP - 1 }).spotsLeft, 1)
  assert.equal(foundersOfferState({ now: OPEN, sold: FOUNDERS_CAP }).open, false)
  assert.equal(foundersOfferState({ now: OPEN, sold: FOUNDERS_CAP }).reason, 'sold_out')
  assert.equal(foundersOfferState({ now: OPEN, sold: FOUNDERS_CAP }).spotsLeft, 0)
})

test('historical lifetime sessions on the same price are not founders spots', () => {
  assert.equal(isFoundersSession(paid('cs_old', {
    created: Math.floor(Date.parse('2026-09-01T00:00:00Z') / 1000),
    payment_link: 'plink_legacy',
    line_items: { data: [{ price: { id: FOUNDERS } }] },
  }), { priceId: FOUNDERS, foundersLinkId: 'plink_founders', legacyLinkId: 'plink_legacy' }), false)

  assert.equal(isFoundersSession(paid('cs_link', { payment_link: 'plink_founders' }), {
    priceId: FOUNDERS,
    foundersLinkId: 'plink_founders',
    legacyLinkId: 'plink_legacy',
  }), true)

  assert.equal(isFoundersSession(paid('cs_meta', { metadata: { cg_plan: 'founders' } }), {
    priceId: FOUNDERS,
  }), true)

  assert.equal(isFoundersSession(paid('cs_open', { payment_status: 'unpaid', metadata: { cg_plan: 'founders' } }), {
    priceId: FOUNDERS,
  }), false)
})

function mockRes() {
  return {
    statusCode: 200,
    headers: {},
    body: undefined,
    setHeader(k, v) { this.headers[k.toLowerCase()] = v },
    status(code) { this.statusCode = code; return this },
    json(obj) { this.body = obj; return this },
  }
}

function mockStripe(sessions) {
  const calls = []
  return {
    calls,
    paymentLinks: {
      async list() {
        return {
          data: [
            { id: 'plink_founders', url: 'https://buy.stripe.com/8x228t2tN5Mabzsf5C5Ne0b' },
            { id: 'plink_legacy', url: 'https://buy.stripe.com/dRmeVfd8r3E2avo4qY5Ne03' },
          ],
          has_more: false,
        }
      },
    },
    checkout: {
      sessions: {
        async list() {
          return { data: sessions, has_more: false }
        },
        async search() {
          return { data: sessions.filter((s) => s.metadata?.cg_plan === 'founders'), has_more: false }
        },
        async create(params) {
          calls.push(params)
          return { id: 'cs_test_created123', url: 'https://checkout.stripe.com/c/pay/cs_test_created123' }
        },
      },
    },
  }
}

async function post(plan, { now, sessions = [], env = {} }) {
  const res = mockRes()
  const stripe = mockStripe(sessions)
  await handleOfferCheckoutRequest(
    { method: 'POST', headers: {}, body: { utm_source: 'x' } },
    res,
    { plan, stripe, now, env, user: null },
  )
  return { res, params: stripe.calls[0] }
}

test('an open founders checkout uses the $99.99 price and has no trial', async () => {
  const { res, params } = await post('founders', { now: OPEN })
  assert.equal(res.statusCode, 200)
  assert.equal(res.body.plan, 'founders')
  assert.equal(res.body.fallback, false)
  assert.equal(params.mode, 'payment')
  assert.equal(params.line_items[0].price, activeFoundersPriceId())
  assert.equal(params.line_items[0].price, FOUNDERS)
  assert.equal(params.metadata.cg_plan, 'founders')
  assert.equal(params.subscription_data, undefined)
  assert.equal(JSON.stringify(params).includes('trial'), false)
  assert.equal(res.body.url.startsWith('https://checkout.stripe.com/'), true)
})

test('founders checkout at the cap or after the deadline falls back to $249.99', async () => {
  const sold = Array.from({ length: 25 }, (_, i) => paid(`cs_${i}`, { metadata: { cg_plan: 'founders' } }))
  const capped = await post('founders', { now: OPEN, sessions: sold })
  assert.equal(capped.res.statusCode, 200)
  assert.equal(capped.res.body.plan, 'lifetime')
  assert.equal(capped.res.body.fallback, true)
  assert.equal(capped.res.body.reason, 'sold_out')
  assert.equal(capped.params.line_items[0].price, LIFETIME)
  assert.equal(capped.params.line_items[0].price, activeLifetimePriceId())
  assert.equal(capped.params.metadata.cg_plan, 'lifetime')
  assert.equal(JSON.stringify(capped.params).includes('trial'), false)

  const expired = await post('founders', { now: DEADLINE })
  assert.equal(expired.res.body.plan, 'lifetime')
  assert.equal(expired.res.body.reason, 'expired')
  assert.equal(expired.params.line_items[0].price, LIFETIME)
})

test('lifetime checkout always uses the $249.99 price', async () => {
  const { res, params } = await post('lifetime', { now: OPEN })
  assert.equal(res.body.plan, 'lifetime')
  assert.equal(res.body.fallback, false)
  assert.equal(params.line_items[0].price, LIFETIME)
  assert.equal(params.mode, 'payment')
  assert.equal(params.subscription_data, undefined)
})

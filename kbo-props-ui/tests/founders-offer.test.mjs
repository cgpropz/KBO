import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  FOUNDERS_CAP,
  FOUNDERS_DEADLINE_LABEL,
  FOUNDERS_DEADLINE_MS,
  FOUNDERS_DEADLINE_SHORT,
  foundersCardCopy,
  foundersOfferState,
  isFoundersCharge,
  isFoundersSession,
} from '../src/foundersOffer.js'
import { handleOfferCheckoutRequest } from '../api/_offerCheckout.js'
import { countFoundersPurchases } from '../api/_foundersCount.js'
import { activeFoundersPriceId, activeLifetimePriceId } from '../api/_stripeTier.js'

const BROWSER_UA = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 Twitter for iPhone'
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

test('founders deadline copy names the end of Oct 18, not Oct 19', () => {
  assert.equal(FOUNDERS_DEADLINE_LABEL, 'Ends Oct 18 at 11:59 PM ET')
  assert.equal(FOUNDERS_DEADLINE_SHORT, 'through Oct 18')
  assert.equal(foundersOfferState({ now: OPEN, sold: 1 }).deadlineLabel, 'Ends Oct 18 at 11:59 PM ET')
  assert.equal(foundersCardCopy({ spotsLeft: 12, cap: 25, soldKnown: true }).meta, '12 of 25 spots left. Ends Oct 18 at 11:59 PM ET')
  assert.equal(foundersCardCopy({ spotsLeft: 12, cap: 25, soldKnown: true }).showBuy, true)
  assert.equal(foundersCardCopy({ cap: 25, compact: true }).meta, 'Limited to 25 buyers, through Oct 18')
  const soldOut = foundersCardCopy({ spotsLeft: 0, cap: 25, soldKnown: true, reason: 'sold_out' })
  assert.equal(soldOut.closedLabel, 'Sold out')
  assert.equal(soldOut.showBuy, false)
  const ended = foundersCardCopy({ spotsLeft: 4, cap: 25, soldKnown: true, reason: 'expired' })
  assert.equal(ended.closedLabel, 'Ended')
  assert.equal(ended.showBuy, false)
})

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

function mockStripe(sessions, { charges = [], invoices = {} } = {}) {
  const calls = []
  return {
    calls,
    charges: {
      async list() {
        return { data: charges, has_more: false }
      },
      async search() {
        return { data: charges.filter((charge) => charge.metadata?.cg_plan === 'founders'), has_more: false }
      },
    },
    invoices: {
      async retrieve(id) {
        return invoices[id] || { id, lines: { data: [] } }
      },
    },
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

async function post(plan, { now, sessions = [], charges = [], invoices = {}, env = {} }) {
  const res = mockRes()
  const stripe = mockStripe(sessions, { charges, invoices })
  await handleOfferCheckoutRequest(
    { method: 'POST', headers: { 'user-agent': BROWSER_UA }, body: { utm_source: 'x' } },
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

test('founders checkout in the last second of 18 Oct ET still uses the $99.99 price', async () => {
  const { res, params } = await post('founders', { now: LAST_SECOND })
  assert.equal(res.statusCode, 200)
  assert.equal(res.body.plan, 'founders')
  assert.equal(params.line_items[0].price, FOUNDERS)
})

test('founders checkout at the cap or after the deadline is refused', async () => {
  const sold = Array.from({ length: 25 }, (_, i) => paid(`cs_${i}`, { metadata: { cg_plan: 'founders' } }))
  const capped = await post('founders', { now: OPEN, sessions: sold })
  assert.equal(capped.res.statusCode, 409)
  assert.equal(capped.res.body.error, 'Founders deal has sold out')
  assert.equal(capped.res.body.reason, 'sold_out')
  assert.equal(capped.res.body.open, false)
  assert.equal(capped.params, undefined)

  const expired = await post('founders', { now: DEADLINE })
  assert.equal(expired.res.statusCode, 409)
  assert.equal(expired.res.body.error, 'Founders deal has ended')
  assert.equal(expired.res.body.reason, 'expired')
  assert.equal(expired.res.body.open, false)
  assert.equal(expired.params, undefined)
})

test('payment-link sales and founders charges share one 25-spot cap', async () => {
  const created = Math.floor(OPEN / 1000)
  assert.equal(isFoundersCharge({
    id: 'ch_old',
    paid: true,
    status: 'succeeded',
    created: Math.floor(Date.parse('2026-09-01T00:00:00Z') / 1000),
    invoice: { lines: { data: [{ price: { id: FOUNDERS } }] } },
  }, { priceId: FOUNDERS }), false)
  assert.equal(isFoundersCharge({
    id: 'ch_refunded',
    paid: true,
    refunded: true,
    status: 'succeeded',
    created,
    metadata: { cg_plan: 'founders' },
  }, { priceId: FOUNDERS }), false)

  const sessions = [
    paid('cs_link', { payment_link: 'plink_founders', payment_intent: 'pi_link' }),
    paid('cs_legacy', {
      payment_link: 'plink_legacy',
      payment_intent: 'pi_legacy',
      line_items: { data: [{ price: { id: FOUNDERS } }] },
    }),
  ]
  const charges = [
    {
      id: 'ch_link',
      paid: true,
      status: 'succeeded',
      created,
      payment_intent: 'pi_link',
      invoice: 'in_link',
    },
    {
      id: 'ch_legacy',
      paid: true,
      status: 'succeeded',
      created,
      payment_intent: 'pi_legacy',
      invoice: 'in_legacy',
    },
    {
      id: 'ch_invoice',
      paid: true,
      status: 'succeeded',
      created,
      payment_intent: 'pi_invoice',
      invoice: 'in_founders',
    },
    {
      id: 'ch_tagged',
      paid: true,
      status: 'succeeded',
      created,
      payment_intent: 'pi_tagged',
      metadata: { cg_plan: 'founders' },
    },
  ]
  const invoices = {
    in_link: { lines: { data: [{ price: { id: FOUNDERS } }] } },
    in_legacy: { lines: { data: [{ price: { id: FOUNDERS } }] } },
    in_founders: { lines: { data: [{ price: { id: FOUNDERS } }] } },
  }
  const stripe = mockStripe(sessions, { charges, invoices })
  assert.equal(await countFoundersPurchases(stripe), 3)

  const almost = Array.from({ length: 24 }, (_, i) => paid(`cs_${i}`, { metadata: { cg_plan: 'founders' } }))
  const capped = await post('founders', {
    now: OPEN,
    sessions: almost,
    charges: [{
      id: 'ch_extra',
      paid: true,
      status: 'succeeded',
      created,
      payment_intent: 'pi_extra',
      metadata: { cg_plan: 'founders' },
    }],
  })
  assert.equal(capped.res.statusCode, 409)
  assert.equal(capped.res.body.error, 'Founders deal has sold out')
  assert.equal(capped.params, undefined)
})

test('lifetime checkout always uses the $249.99 price', async () => {
  const { res, params } = await post('lifetime', { now: OPEN })
  assert.equal(res.body.plan, 'lifetime')
  assert.equal(res.body.fallback, false)
  assert.equal(params.line_items[0].price, LIFETIME)
  assert.equal(params.metadata.price_id, LIFETIME)
  assert.equal(params.mode, 'payment')
  assert.equal(params.subscription_data, undefined)
})

test('crawlers do not open a lifetime or founders session', async () => {
  for (const plan of ['lifetime', 'founders']) {
    const res = mockRes()
    const stripe = mockStripe([])
    await handleOfferCheckoutRequest(
      { method: 'POST', headers: { 'user-agent': 'Twitterbot/1.0' }, body: {} },
      res,
      { plan, stripe, now: OPEN, user: null },
    )
    assert.equal(res.statusCode, 403, plan)
    assert.equal(stripe.calls.length, 0, plan)
  }
})

test('an open lifetime session for the same customer and price is reused', async () => {
  const OPEN_URL = 'https://checkout.stripe.com/c/pay/cs_test_openlife'
  const calls = []
  const stripe = {
    customers: { async list() { return { data: [{ id: 'cus_1', email: 'buyer@example.com' }] } } },
    checkout: { sessions: {
      async list(params) { calls.push(['list', params]); return { data: [{
        url: OPEN_URL,
        mode: 'payment',
        expires_at: Math.floor(OPEN / 1000) + 20 * 3600,
        metadata: { cg_plan: 'lifetime', price_id: LIFETIME, tier: 'combined' },
      }] } },
      async create(params) { calls.push(['create', params]); return { url: 'https://checkout.stripe.com/c/pay/cs_test_new' } },
    } },
  }
  const res = mockRes()
  await handleOfferCheckoutRequest(
    { method: 'POST', headers: { 'user-agent': BROWSER_UA }, body: {} },
    res,
    { plan: 'lifetime', stripe, now: OPEN, user: { id: 'user_1', email: 'buyer@example.com' } },
  )
  assert.equal(res.statusCode, 200)
  assert.equal(res.body.url, OPEN_URL)
  assert.deepEqual(calls.map((call) => call[0]), ['list'])
  assert.deepEqual(calls[0][1], { customer: 'cus_1', status: 'open', limit: 20 })
})

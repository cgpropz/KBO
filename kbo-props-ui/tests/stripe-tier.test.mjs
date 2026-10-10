// Unit tests for case-insensitive Stripe entitlement lookup.
// No network, no credentials. Run: npm run test:api
import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  LIFETIME_AMOUNT,
  computeStripeTier,
  customersForEmail,
  mergeTier,
  tierForPrice,
} from '../api/_stripeTier.js'

const WEEKLY = 'price_1TtFErPwL0k9PEMvIrEJajK1'
const MONTHLY = 'price_1TtFFePwL0k9PEMvPJUUwuTr'
const LEGACY_KBO = 'price_1THCokPwL0k9PEMvcWwT7F2c'

function customer(id, email) {
  return { id, email }
}

function sub(priceId, status = 'active') {
  return { id: `sub_${priceId}_${status}`, status, items: { data: [{ price: { id: priceId } }] } }
}

function mockStripe({ listByEmail = {}, searchByQuery = {}, subsByCustomer = {}, chargesByCustomer = {} } = {}) {
  const calls = []
  return {
    calls,
    customers: {
      async list({ email, limit }) {
        calls.push({ op: 'list', email, limit })
        return { data: listByEmail[email] || [] }
      },
      async search({ query, limit }) {
        calls.push({ op: 'search', query, limit })
        return { data: searchByQuery[query] || [] }
      },
    },
    subscriptions: {
      async list({ customer }) {
        calls.push({ op: 'subs', customer })
        return { data: subsByCustomer[customer] || [] }
      },
    },
    charges: {
      async list({ customer }) {
        calls.push({ op: 'charges', customer })
        return { data: chargesByCustomer[customer] || [] }
      },
    },
  }
}

test('weekly price grants combined and the legacy kbo price stays kbo', () => {
  assert.equal(tierForPrice(WEEKLY), 'combined')
  assert.equal(tierForPrice(MONTHLY), 'combined')
  assert.equal(tierForPrice(LEGACY_KBO), 'kbo')
  assert.equal(mergeTier('free', 'combined'), 'combined')
  assert.equal(mergeTier('combined', 'monthly'), 'combined')
  assert.equal(mergeTier('kbo', 'combined'), 'combined')
  assert.equal(mergeTier('monthly', 'combined'), 'monthly')
  assert.equal(mergeTier('kbo', 'kbo'), 'kbo')
})

test('a lowercase login finds an uppercase Checkout email and grants weekly access', async () => {
  const stripe = mockStripe({
    searchByQuery: {
      'email:"klaw1193@icloud.com"': [customer('cus_VPbDZ7o6mer1ZC', 'KLAW1193@icloud.com')],
    },
    subsByCustomer: {
      cus_VPbDZ7o6mer1ZC: [sub(WEEKLY)],
    },
  })

  const tier = await computeStripeTier(stripe, 'klaw1193@icloud.com')
  assert.equal(tier, 'combined')
  assert.deepEqual(
    stripe.calls.filter((c) => c.op === 'list').map((c) => c.email),
    ['klaw1193@icloud.com'],
  )
  assert.equal(stripe.calls.some((c) => c.op === 'search' && c.query === 'email:"klaw1193@icloud.com"'), true)
})

test('an exact-case list hit does not call search', async () => {
  const stripe = mockStripe({
    listByEmail: {
      'KLAW1193@icloud.com': [customer('cus_VPbDZ7o6mer1ZC', 'KLAW1193@icloud.com')],
    },
    subsByCustomer: { cus_VPbDZ7o6mer1ZC: [sub(WEEKLY)] },
  })

  const tier = await computeStripeTier(stripe, 'KLAW1193@icloud.com')
  assert.equal(tier, 'combined')
  assert.equal(stripe.calls.some((c) => c.op === 'search'), false)
  assert.deepEqual(
    stripe.calls.filter((c) => c.op === 'list').map((c) => c.email),
    ['KLAW1193@icloud.com', 'klaw1193@icloud.com'],
  )
})

test('no stripe customer stays free', async () => {
  const stripe = mockStripe()
  assert.equal(await computeStripeTier(stripe, 'nobody@example.com'), 'free')
  assert.equal(stripe.calls.some((c) => c.op === 'subs'), false)
  assert.deepEqual(await customersForEmail(stripe, 'not-an-email'), [])
})

test('a paid non-refunded lifetime charge grants combined without a subscription', async () => {
  const stripe = mockStripe({
    listByEmail: {
      'fan@example.com': [customer('cus_life', 'fan@example.com')],
    },
    chargesByCustomer: {
      cus_life: [{ paid: true, refunded: false, amount: LIFETIME_AMOUNT }],
    },
  })
  assert.equal(await computeStripeTier(stripe, 'fan@example.com'), 'combined')

  const refunded = mockStripe({
    listByEmail: { 'fan@example.com': [customer('cus_life', 'fan@example.com')] },
    chargesByCustomer: { cus_life: [{ paid: true, refunded: true, amount: LIFETIME_AMOUNT }] },
  })
  assert.equal(await computeStripeTier(refunded, 'fan@example.com'), 'free')
})

test('search hits whose email does not match are ignored', async () => {
  const stripe = mockStripe({
    searchByQuery: {
      'email:"klaw1193@icloud.com"': [
        customer('cus_noise', 'other@icloud.com'),
        customer('cus_real', 'KLAW1193@icloud.com'),
      ],
    },
    subsByCustomer: {
      cus_noise: [sub(MONTHLY)],
      cus_real: [sub(WEEKLY)],
    },
  })
  assert.equal(await computeStripeTier(stripe, '  klaw1193@icloud.com  '), 'combined')
  assert.deepEqual(
    stripe.calls.filter((c) => c.op === 'subs').map((c) => c.customer),
    ['cus_real'],
  )
})

test('a legacy kbo subscription alone stays kbo', async () => {
  const stripe = mockStripe({
    listByEmail: {
      'braylonkidd23@icloud.com': [customer('cus_kbo', 'Braylonkidd23@icloud.com')],
    },
    subsByCustomer: { cus_kbo: [sub(LEGACY_KBO)] },
  })
  assert.equal(await computeStripeTier(stripe, 'braylonkidd23@icloud.com'), 'kbo')
})

test('two customers on one email union a legacy sport with all-access', async () => {
  const stripe = mockStripe({
    searchByQuery: {
      'email:"marianogarcia2300@icloud.com"': [
        customer('cus_kbo', 'Marianogarcia2300@icloud.com'),
        customer('cus_all', 'Marianogarcia2300@icloud.com'),
      ],
    },
    subsByCustomer: {
      cus_kbo: [sub(LEGACY_KBO)],
      cus_all: [sub(MONTHLY)],
    },
  })
  assert.equal(await computeStripeTier(stripe, 'marianogarcia2300@icloud.com'), 'combined')
})

test('canceled subscriptions do not grant access', async () => {
  const stripe = mockStripe({
    listByEmail: { 'fan@example.com': [customer('cus_old', 'fan@example.com')] },
    subsByCustomer: { cus_old: [sub(WEEKLY, 'canceled'), sub(WEEKLY, 'past_due')] },
  })
  assert.equal(await computeStripeTier(stripe, 'fan@example.com'), 'free')
})

test('quotes in an email are escaped in the search query', async () => {
  const stripe = mockStripe()
  await customersForEmail(stripe, 'a"b@example.com')
  assert.equal(stripe.calls.find((c) => c.op === 'search').query, 'email:"a\\"b@example.com"')
})

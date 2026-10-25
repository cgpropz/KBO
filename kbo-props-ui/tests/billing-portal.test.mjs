// Billing portal sessions. Stripe and Supabase are mocked. No network and no
// live Stripe writes.
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'
import { fileURLToPath } from 'node:url'
import { join } from 'node:path'
import { CHECKOUT_ACTIONS } from '../api/checkout/[action].js'
import {
  ACCOUNT_FALLBACK_URL,
  ACCOUNT_PAGE_URL,
  BILLING_PORTAL_CONFIGURATION,
  NO_ACTIVE_PLAN_MESSAGE,
  PAYMENT_METHOD_UPDATE_FLOW,
  billingPortalReturnUrl,
  billingPortalSessionParams,
  handleBillingPortalRequest,
} from '../api/_billingPortal.js'

const EMAIL = 'member@example.com'
const FORGED_CUSTOMER = 'cus_forged'
const FORGED_EMAIL = 'attacker@evil.example'

function mockRes() {
  return {
    statusCode: 200,
    headers: {},
    body: undefined,
    setHeader(key, value) { this.headers[key.toLowerCase()] = value },
    status(code) { this.statusCode = code; return this },
    json(obj) { this.body = obj; return this },
    end(msg) { this.body = msg; return this },
  }
}

function userSupabase(user = { id: 'user_member_1', email: EMAIL }) {
  const calls = []
  return {
    calls,
    auth: {
      async getUser(token) {
        calls.push(token)
        if (token !== 'session-token') return { data: { user: null }, error: new Error('bad') }
        return { data: { user }, error: null }
      },
    },
  }
}

function mockStripe({ customers = [], subsByCustomer = {} } = {}) {
  const calls = []
  return {
    calls,
    customers: {
      async list({ email } = {}) {
        calls.push({ op: 'customers.list', email })
        return { data: customers.filter((row) => (row.email || '').toLowerCase() === String(email || '').toLowerCase()) }
      },
      async search({ query } = {}) {
        calls.push({ op: 'customers.search', query })
        return { data: [] }
      },
      async retrieve(id) {
        calls.push({ op: 'customers.retrieve', id })
        return customers.find((row) => row.id === id) || null
      },
    },
    subscriptions: {
      async list({ customer, status } = {}) {
        calls.push({ op: 'subscriptions.list', customer, status })
        const rows = subsByCustomer[customer] || []
        const data = status && status !== 'all' ? rows.filter((row) => row.status === status) : rows
        return { data }
      },
    },
    billingPortal: {
      sessions: {
        async create(params) {
          calls.push({ op: 'billingPortal.sessions.create', params })
          return { id: 'bps_test', url: `https://billing.stripe.com/p/session/test_${params.customer}` }
        },
      },
    },
  }
}

async function post(body, { authorization = 'Bearer session-token', stripe, supabase, url } = {}) {
  const res = mockRes()
  let constructed = false
  await handleBillingPortalRequest({
    method: 'POST',
    headers: authorization ? { authorization } : {},
    body,
    url,
  }, res, {
    env: { STRIPE_SECRET_KEY: 'sk_test_billing_portal_unit' },
    stripe,
    supabase: supabase || userSupabase(),
    getStripe() {
      constructed = true
      throw new Error('live Stripe client')
    },
  })
  return { res, stripe, constructed }
}

test('return url stays on the cgpropz account page', () => {
  assert.equal(billingPortalReturnUrl(), ACCOUNT_PAGE_URL)
  assert.equal(billingPortalReturnUrl(), 'https://www.cgpropz.com/?account=1')
  assert.equal(billingPortalReturnUrl('https://evil.example/account'), ACCOUNT_FALLBACK_URL)
  assert.equal(billingPortalReturnUrl('http://www.cgpropz.com/?account=1'), ACCOUNT_FALLBACK_URL)
  assert.equal(billingPortalReturnUrl('https://cgpropz.com/?account=1'), 'https://www.cgpropz.com/')
  assert.equal(BILLING_PORTAL_CONFIGURATION, 'bpc_1URCyLPwL0k9PEMv395S66ul')
})

test('no Stripe customer returns the no-plan response and does not create a portal session', async () => {
  const stripe = mockStripe()
  const { res, constructed } = await post({ customer: FORGED_CUSTOMER }, { stripe })
  assert.equal(res.statusCode, 404)
  assert.equal(res.body.error, NO_ACTIVE_PLAN_MESSAGE)
  assert.equal(res.body.error, 'No active plan on this email. DM @Cgpropz.')
  assert.equal(stripe.calls.some((call) => call.op === 'billingPortal.sessions.create'), false)
  assert.equal(constructed, false)
})

test('a canceled-only customer is not a billing portal customer', async () => {
  const stripe = mockStripe({
    customers: [{ id: 'cus_canceled', email: EMAIL, created: 900 }],
    subsByCustomer: {
      cus_canceled: [{ id: 'sub_canceled', status: 'canceled' }],
    },
  })
  const { res } = await post({}, { stripe })
  assert.equal(res.statusCode, 404)
  assert.equal(res.body.error, NO_ACTIVE_PLAN_MESSAGE)
  assert.equal(stripe.calls.some((call) => call.op === 'billingPortal.sessions.create'), false)
  assert.deepEqual(
    stripe.calls.filter((call) => call.op === 'subscriptions.list').map((call) => call.status),
    ['active', 'past_due'],
  )
})

test('the most recent customer with an active or past_due subscription wins', async () => {
  const stripe = mockStripe({
    customers: [
      { id: 'cus_old', email: EMAIL, created: 100 },
      { id: 'cus_canceled_newer', email: EMAIL, created: 900 },
      { id: 'cus_recent', email: EMAIL, created: 500 },
    ],
    subsByCustomer: {
      cus_old: [{ id: 'sub_old', status: 'active' }],
      cus_canceled_newer: [{ id: 'sub_canceled', status: 'canceled' }],
      cus_recent: [{ id: 'sub_recent', status: 'past_due' }],
    },
  })
  const { res } = await post({}, { stripe })
  assert.equal(res.statusCode, 200)
  assert.equal(res.body.url, 'https://billing.stripe.com/p/session/test_cus_recent')
  const created = stripe.calls.find((call) => call.op === 'billingPortal.sessions.create')
  assert.deepEqual(created.params, {
    customer: 'cus_recent',
    configuration: BILLING_PORTAL_CONFIGURATION,
    return_url: ACCOUNT_PAGE_URL,
  })
  assert.equal(created.params.customer === 'cus_old', false)
  assert.equal(created.params.customer === 'cus_canceled_newer', false)
})

test('a forged client customer id and email are ignored', async () => {
  const stripe = mockStripe({
    customers: [{ id: 'cus_real', email: EMAIL, created: 200 }],
    subsByCustomer: {
      cus_real: [{ id: 'sub_real', status: 'active' }],
      [FORGED_CUSTOMER]: [{ id: 'sub_forged', status: 'active' }],
    },
  })
  const supabase = userSupabase()
  const { res, constructed } = await post({
    customer: FORGED_CUSTOMER,
    customer_id: FORGED_CUSTOMER,
    email: FORGED_EMAIL,
  }, {
    stripe,
    supabase,
    url: `/api/billing-portal?customer=${FORGED_CUSTOMER}&email=${encodeURIComponent(FORGED_EMAIL)}`,
  })
  assert.equal(res.statusCode, 200)
  assert.equal(constructed, false)
  assert.deepEqual(supabase.calls, ['session-token'])
  const created = stripe.calls.find((call) => call.op === 'billingPortal.sessions.create')
  assert.equal(created.params.customer, 'cus_real')
  assert.equal(created.params.customer === FORGED_CUSTOMER, false)
  const listed = stripe.calls.filter((call) => call.op === 'customers.list')
  assert.ok(listed.length > 0)
  assert.ok(listed.every((call) => call.email === EMAIL))
  const text = JSON.stringify(stripe.calls)
  assert.equal(text.includes(FORGED_CUSTOMER), false)
  assert.equal(text.includes(FORGED_EMAIL), false)
  assert.equal(res.body.customer, undefined)
})

test('unauthenticated requests return 401 and do not call Stripe', async () => {
  const stripe = mockStripe({
    customers: [{ id: 'cus_real', email: EMAIL, created: 200 }],
    subsByCustomer: { cus_real: [{ id: 'sub_real', status: 'active' }] },
  })
  const missing = await post({ customer: FORGED_CUSTOMER }, { authorization: '', stripe })
  assert.equal(missing.res.statusCode, 401)
  assert.equal(missing.res.body.error, 'Missing authorization token')
  assert.equal(stripe.calls.length, 0)
  assert.equal(missing.constructed, false)

  const forged = await post({ customer: FORGED_CUSTOMER }, { authorization: 'Bearer not-a-session', stripe })
  assert.equal(forged.res.statusCode, 401)
  assert.equal(forged.res.body.error, 'Invalid or expired token')
  assert.equal(stripe.calls.length, 0)
  assert.equal(forged.constructed, false)
})

test('update-card is the only client flow, and forged portal fields are dropped', async () => {
  assert.equal(PAYMENT_METHOD_UPDATE_FLOW, 'payment_method_update')
  const stripe = mockStripe({
    customers: [{ id: 'cus_real', email: EMAIL, created: 200 }],
    subsByCustomer: { cus_real: [{ id: 'sub_real', status: 'active' }] },
  })
  const { res } = await post({
    flow: 'payment_method_update',
    flow_data: { type: 'subscription_cancel' },
    customer: FORGED_CUSTOMER,
    return_url: 'https://evil.example/phish',
    configuration: 'bpc_evil',
  }, { stripe })
  assert.equal(res.statusCode, 200)
  const created = stripe.calls.find((call) => call.op === 'billingPortal.sessions.create')
  assert.deepEqual(created.params, {
    customer: 'cus_real',
    configuration: BILLING_PORTAL_CONFIGURATION,
    return_url: ACCOUNT_PAGE_URL,
    flow_data: { type: 'payment_method_update' },
  })
  assert.equal(JSON.stringify(created.params).includes(FORGED_CUSTOMER), false)
  assert.equal(JSON.stringify(created.params).includes('evil.example'), false)
  assert.equal(JSON.stringify(created.params).includes('bpc_evil'), false)
  assert.equal(JSON.stringify(created.params).includes('subscription_cancel'), false)

  const general = billingPortalSessionParams('cus_real', {
    flow: 'subscription_cancel',
    flow_data: { type: 'payment_method_update' },
  })
  assert.equal(general.flow_data, undefined)
  assert.deepEqual(billingPortalSessionParams('cus_real', JSON.parse('{"flow":"payment_method_update"}')).flow_data, {
    type: 'payment_method_update',
  })
})

test('the checkout dispatcher exposes the portal handler and the account page posts no customer id', () => {
  assert.equal(CHECKOUT_ACTIONS.portal, handleBillingPortalRequest)
  const uiRoot = fileURLToPath(new URL('..', import.meta.url))
  const page = readFileSync(join(uiRoot, 'src/SubscriptionPage.jsx'), 'utf8')
  assert.match(page, /Update payment method/)
  assert.match(page, /Manage subscription/)
  assert.match(page, /payment_method_update/)
  assert.match(page, /noActivePlanNotice\(user\?\.email\)/)
  const copy = readFileSync(join(uiRoot, 'src/manageSubscriptionCopy.js'), 'utf8')
  assert.match(copy, /No active plan on this email\. DM @Cgpropz\./)
  assert.match(copy, /Signed in as \$\{value\} — your plan may be under a different email\./)
  assert.match(page, /\/api\/billing-portal/)
  assert.match(page, /'\{\}'/)
  assert.doesNotMatch(page, /billing\.stripe\.com/)
  assert.doesNotMatch(page, /billing-portal[\s\S]{0,800}cus_/)
  const loginUrl = 'https://billing.stripe.com/p/login/eVq9AV4BV4I6bzs7Da5Ne00'
  for (const rel of ['src/SubscriptionPage.jsx', 'src/PublicLanding.jsx', 'src/tracking.js']) {
    assert.equal(readFileSync(join(uiRoot, rel), 'utf8').includes(loginUrl), false, rel)
  }
  assert.equal(JSON.stringify(billingPortalSessionParams('cus_real', { flow: 'payment_method_update' })).includes(loginUrl), false)
})

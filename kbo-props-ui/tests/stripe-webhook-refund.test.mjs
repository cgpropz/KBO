import assert from 'node:assert/strict'
import test from 'node:test'
import {
  accessAfterSyncRecompute,
  lifetimeChargeBlocksAccess,
  reconcileTierForSubscription,
} from '../api/_stripeTier.js'
import { sessionGrantsLifetime } from '../api/reconcile-subscriptions.js'
import {
  clearTierByCustomer,
  clearTierByEmail,
  handleChargeRefunded,
  handleDisputeEvent,
  handleInvoicePaymentSucceeded,
} from '../api/stripe-webhook.js'

const PERIOD = { start: 1_700_000_000, end: 1_700_604_800 }
const PREVIOUS = { start: PERIOD.start - 604_800, end: PERIOD.start }
const EMAIL = 'member@example.com'
const KBO = 'price_1THCokPwL0k9PEMvcWwT7F2c'
const WNBA = 'price_1TtFEPPwL0k9PEMvc8kcK6Ut'

function paidCharge(id, _invoiceId, extra = {}) {
  return {
    id,
    customer: 'cus_1',
    amount: 1999,
    amount_refunded: 0,
    refunded: false,
    paid: true,
    disputed: false,
    payment_intent: `pi_${id}`,
    ...extra,
  }
}

function refundedCharge(id, invoiceId, extra = {}) {
  return paidCharge(id, invoiceId, { amount_refunded: 1999, refunded: true, ...extra })
}

function invoiceFor(id, subscriptionId, charge, period) {
  return {
    id,
    parent: { subscription_details: { subscription: subscriptionId } },
    lines: { data: [{ amount: charge.amount, period }] },
    payments: {
      data: [{
        id: `inpay_${id}`,
        status: 'paid',
        invoice: id,
        payment: {
          type: 'payment_intent',
          payment_intent: {
            id: charge.payment_intent,
            latest_charge: charge,
          },
        },
      }],
    },
  }
}

function plan(id, priceId, period, invoice) {
  return {
    id,
    status: 'active',
    latest_invoice: invoice,
    items: {
      data: [{
        price: { id: priceId },
        current_period_start: period.start,
        current_period_end: period.end,
      }],
    },
  }
}

function mockDb() {
  const state = {
    upserts: [],
    claimWrites: [],
    upsertError: null,
    claimError: null,
    metadata: { provider: 'email', tier: 'combined' },
    missingUser: false,
    listError: null,
  }
  const chain = {
    select() { return chain },
    eq() { return chain },
    limit() { return Promise.resolve({ data: [], error: null }) },
    update() { return chain },
    upsert(row) {
      state.upserts.push(row)
      return Promise.resolve({ error: state.upsertError })
    },
  }
  return {
    state,
    from() { return chain },
    auth: {
      admin: {
        async getUserByEmail() {
          if (state.missingUser || state.listError) return { data: { user: null } }
          return { data: { user: { id: 'user-1', email: EMAIL, app_metadata: { ...state.metadata } } } }
        },
        async listUsers() {
          if (state.listError) return { error: state.listError, data: { users: [] } }
          return { data: { users: [] } }
        },
        async getUserById() {
          return { data: { user: { id: 'user-1', app_metadata: { ...state.metadata } } } }
        },
        async updateUserById(_id, { app_metadata }) {
          state.claimWrites.push(app_metadata)
          if (state.claimError) return { error: state.claimError }
          state.metadata = { ...app_metadata }
          return { error: null }
        },
      },
    },
  }
}

function entitlementStripe({ subs = [], charges = [], invoices = {} } = {}) {
  const invoiceById = { ...invoices }
  for (const sub of subs) {
    const latest = sub.latest_invoice
    if (latest?.id) invoiceById[latest.id] = latest
  }
  return {
    customers: {
      async retrieve(id) { return { id, email: EMAIL } },
      async list() { return { data: [{ id: 'cus_1', email: EMAIL }] } },
      async search() { return { data: [] } },
    },
    subscriptions: {
      async list() { return { data: subs } },
      async retrieve(id) { return subs.find((sub) => sub.id === id) || null },
    },
    charges: {
      async list() { return { data: charges } },
      async retrieve(id) { return charges.find((charge) => charge.id === id) || null },
    },
    invoices: {
      async retrieve(id) { return invoiceById[id] || null },
    },
    invoicePayments: {
      async list(params = {}) {
        const rows = Object.values(invoiceById).flatMap((invoice) => invoice?.payments?.data || [])
        const invoiceId = params.invoice
        const paymentIntent = params.payment?.payment_intent
        const data = rows.filter((row) => {
          if (invoiceId && row.invoice !== invoiceId) return false
          if (paymentIntent) {
            const intent = row.payment?.payment_intent
            const id = typeof intent === 'string' ? intent : intent?.id
            if (id !== paymentIntent) return false
          }
          return true
        })
        return { data }
      },
    },
    disputes: {
      async list({ charge } = {}) {
        const found = charges.find((item) => item.id === charge)
        if (!found?.disputed) return { data: [] }
        return { data: [{ id: `dp_${charge}`, status: found.dispute_status || 'needs_response', charge }] }
      },
    },
  }
}

function kboPlan(charge = paidCharge('ch_kbo', 'in_kbo')) {
  const invoice = invoiceFor('in_kbo', 'sub_kbo', charge, PERIOD)
  return {
    charge,
    invoice,
    sub: plan('sub_kbo', KBO, PERIOD, invoice),
  }
}

test('a full refund of the current period recomputes to free and a partial refund keeps access', async () => {
  const current = refundedCharge('ch_full', 'in_kbo')
  const planState = kboPlan(current)
  const db = mockDb()
  const failure = await handleChargeRefunded(current, {
    stripe: entitlementStripe({ subs: [planState.sub], charges: [current], invoices: { in_kbo: planState.invoice } }),
    supabase: db,
  })
  assert.equal(failure, null)
  assert.deepEqual(db.state.upserts, [{ id: 'user-1', tier: 'free' }])
  assert.equal(db.state.claimWrites[0].tier, 'free')
  assert.equal(db.state.claimWrites[0].provider, 'email')

  const partial = paidCharge('ch_part', 'in_kbo', { amount: 1999, amount_refunded: 500, refunded: false })
  const partialPlan = kboPlan(partial)
  const kept = mockDb()
  const keep = await handleChargeRefunded(partial, {
    stripe: entitlementStripe({
      subs: [partialPlan.sub],
      charges: [partial],
      invoices: { in_kbo: partialPlan.invoice },
    }),
    supabase: kept,
  })
  assert.equal(keep, null)
  assert.equal(kept.state.upserts.length, 0)
  assert.equal(kept.state.claimWrites.length, 0)
})

test('a partial refund that covers the current period recomputes, and a smaller one does not', async () => {
  const covered = paidCharge('ch_cover', 'in_kbo', { amount: 2199, amount_refunded: 1999, refunded: false })
  const coveredPlan = kboPlan(covered)
  coveredPlan.invoice.lines.data[0].amount = 1999
  const revoked = mockDb()
  const revoke = await handleChargeRefunded(covered, {
    stripe: entitlementStripe({
      subs: [coveredPlan.sub],
      charges: [covered],
      invoices: { in_kbo: coveredPlan.invoice },
    }),
    supabase: revoked,
  })
  assert.equal(revoke, null)
  assert.deepEqual(revoked.state.upserts, [{ id: 'user-1', tier: 'free' }])

  const small = paidCharge('ch_small', 'in_kbo', { amount: 2199, amount_refunded: 500, refunded: false })
  const smallPlan = kboPlan(small)
  smallPlan.invoice.lines.data[0].amount = 1999
  const kept = mockDb()
  const keep = await handleChargeRefunded(small, {
    stripe: entitlementStripe({
      subs: [smallPlan.sub],
      charges: [small],
      invoices: { in_kbo: smallPlan.invoice },
    }),
    supabase: kept,
  })
  assert.equal(keep, null)
  assert.equal(kept.state.upserts.length, 0)
})

test('a customer with several plans keeps the plan that was not refunded', async () => {
  const kbo = paidCharge('ch_kbo', 'in_kbo')
  const wnba = refundedCharge('ch_wnba', 'in_wnba')
  const kboInvoice = invoiceFor('in_kbo', 'sub_kbo', kbo, PERIOD)
  const wnbaInvoice = invoiceFor('in_wnba', 'sub_wnba', wnba, PERIOD)
  const subs = [
    plan('sub_kbo', KBO, PERIOD, kboInvoice),
    plan('sub_wnba', WNBA, PERIOD, wnbaInvoice),
  ]
  const stripe = entitlementStripe({ subs, charges: [kbo, wnba] })
  const db = mockDb()
  const failure = await handleChargeRefunded(wnba, { stripe, supabase: db })
  assert.equal(failure, null)
  assert.deepEqual(db.state.upserts, [{ id: 'user-1', tier: 'kbo' }])
  assert.equal(db.state.claimWrites[0].tier, 'kbo')

  const synced = await accessAfterSyncRecompute(stripe, EMAIL, 'free')
  assert.equal(synced.unchanged, false)
  assert.equal(synced.tier, 'kbo')
  assert.equal(await reconcileTierForSubscription(stripe, subs[0]), 'kbo')
  assert.equal(await reconcileTierForSubscription(stripe, subs[1]), null)
})

test('a lifetime purchase survives a refunded subscription, and a refunded lifetime does not', async () => {
  const kbo = refundedCharge('ch_kbo', 'in_kbo')
  const kboInvoice = invoiceFor('in_kbo', 'sub_kbo', kbo, PERIOD)
  const lifetime = {
    id: 'ch_life',
    customer: 'cus_1',
    amount: 9999,
    amount_refunded: 0,
    refunded: false,
    paid: true,
    disputed: false,
    metadata: { cg_plan: 'lifetime' },
  }
  const stripe = entitlementStripe({
    subs: [plan('sub_kbo', KBO, PERIOD, kboInvoice)],
    charges: [kbo, lifetime],
  })
  const db = mockDb()
  const failure = await handleChargeRefunded(kbo, { stripe, supabase: db })
  assert.equal(failure, null)
  assert.equal(db.state.upserts.at(-1).tier, 'combined')

  lifetime.refunded = true
  lifetime.amount_refunded = 9999
  const dropped = mockDb()
  const revoked = await handleChargeRefunded(lifetime, { stripe, supabase: dropped })
  assert.equal(revoked, null)
  assert.equal(dropped.state.upserts.at(-1).tier, 'free')
  assert.equal(await lifetimeChargeBlocksAccess(lifetime), true)
})

test('a full refund of an old invoice does not revoke the current period', async () => {
  const current = paidCharge('ch_cur', 'in_cur')
  const currentInvoice = invoiceFor('in_cur', 'sub_kbo', current, PERIOD)
  const old = refundedCharge('ch_old', 'in_old')
  const oldInvoice = invoiceFor('in_old', 'sub_kbo', old, PREVIOUS)
  const sub = plan('sub_kbo', KBO, PERIOD, currentInvoice)
  const db = mockDb()
  const failure = await handleChargeRefunded(old, {
    stripe: entitlementStripe({
      subs: [sub],
      charges: [current, old],
      invoices: { in_old: oldInvoice, in_cur: currentInvoice },
    }),
    supabase: db,
  })
  assert.equal(failure, null)
  assert.equal(db.state.upserts.length, 0)
  assert.equal(db.state.claimWrites.length, 0)
  assert.equal(db.state.metadata.tier, 'combined')
})

test('sync and reconcile do not re-grant a refunded or disputed current period', async () => {
  const refunded = refundedCharge('ch_kbo', 'in_kbo')
  const refundedInvoice = invoiceFor('in_kbo', 'sub_kbo', refunded, PERIOD)
  const refundedSub = plan('sub_kbo', KBO, PERIOD, refundedInvoice)
  const disputed = paidCharge('ch_dis', 'in_dis', { disputed: true })
  const disputedInvoice = invoiceFor('in_dis', 'sub_dis', disputed, PERIOD)
  const disputedSub = plan('sub_dis', WNBA, PERIOD, disputedInvoice)
  const stripe = entitlementStripe({
    subs: [refundedSub, disputedSub],
    charges: [refunded, disputed],
  })

  const synced = await accessAfterSyncRecompute(stripe, EMAIL, 'free')
  assert.equal(synced.tier, 'free')
  assert.equal(await reconcileTierForSubscription(stripe, refundedSub), null)
  assert.equal(await reconcileTierForSubscription(stripe, disputedSub), null)

  const paid = { customers: { list() { throw new Error('paid profiles do not ask Stripe') } } }
  const kept = await accessAfterSyncRecompute(paid, EMAIL, 'combined')
  assert.equal(kept.unchanged, true)
  assert.equal(kept.tier, 'combined')

  const won = paidCharge('ch_won', 'in_won', { disputed: true, dispute_status: 'won' })
  const wonInvoice = invoiceFor('in_won', 'sub_won', won, PERIOD)
  const wonSub = plan('sub_won', KBO, PERIOD, wonInvoice)
  const restored = await accessAfterSyncRecompute(
    entitlementStripe({ subs: [wonSub], charges: [won] }),
    EMAIL,
    'free',
  )
  assert.equal(restored.tier, 'kbo')
})

test('reconcile skips a refunded or disputed lifetime charge and keeps a clear one', async () => {
  assert.equal(await lifetimeChargeBlocksAccess({ paid: true, refunded: true, amount: 9999 }), true)
  assert.equal(await lifetimeChargeBlocksAccess({ id: 'ch_open', paid: true, disputed: true, refunded: false, amount: 24999 }), true)
  const won = {
    disputes: { async list() { return { data: [{ status: 'won', charge: 'ch_won' }] } } },
  }
  assert.equal(await lifetimeChargeBlocksAccess({
    id: 'ch_won',
    paid: true,
    disputed: true,
    refunded: false,
    amount: 24999,
  }, won), false)
  assert.equal(await lifetimeChargeBlocksAccess({
    paid: true,
    refunded: false,
    disputed: false,
    amount: 9999,
    amount_refunded: 100,
  }), false)
  assert.equal(await lifetimeChargeBlocksAccess(null), false)
})

test('a replayed invoice payment recomputes instead of granting the refunded charge', async () => {
  const kbo = paidCharge('ch_kbo', 'in_kbo')
  const kboInvoice = invoiceFor('in_kbo', 'sub_kbo', kbo, PERIOD)
  const refunded = refundedCharge('ch_wnba', 'in_pay')
  const db = mockDb()
  const failure = await handleInvoicePaymentSucceeded({
    id: 'in_pay',
    customer: 'cus_1',
    billing_reason: 'subscription_cycle',
    parent: { subscription_details: { subscription: 'sub_wnba' } },
    lines: { data: [{ amount: 1999, period: PERIOD, price: { id: WNBA } }] },
    payments: {
      data: [{
        id: 'inpay_in_pay',
        status: 'paid',
        invoice: 'in_pay',
        payment: {
          type: 'payment_intent',
          payment_intent: { id: refunded.payment_intent, latest_charge: refunded },
        },
      }],
    },
  }, {
    stripe: entitlementStripe({ subs: [plan('sub_kbo', KBO, PERIOD, kboInvoice)], charges: [kbo, refunded] }),
    supabase: db,
  })
  assert.equal(failure, null)
  assert.deepEqual(db.state.upserts, [{ id: 'user-1', tier: 'kbo' }])
  assert.equal(db.state.claimWrites[0].tier, 'kbo')
})

test('a dispute on the current period or a lifetime charge revokes, and an old dispute does not', async () => {
  const current = paidCharge('ch_cur', 'in_cur', { disputed: true })
  const currentInvoice = invoiceFor('in_cur', 'sub_kbo', current, PERIOD)
  const sub = plan('sub_kbo', KBO, PERIOD, currentInvoice)
  for (const type of ['charge.dispute.created', 'charge.dispute.funds_withdrawn']) {
    const db = mockDb()
    const failure = await handleDisputeEvent({
      type,
      data: { object: { id: 'dp_1', charge: 'ch_cur', status: 'needs_response' } },
    }, {
      stripe: entitlementStripe({ subs: [sub], charges: [current], invoices: { in_cur: currentInvoice } }),
      supabase: db,
    })
    assert.equal(failure, null)
    assert.deepEqual(db.state.upserts, [{ id: 'user-1', tier: 'free' }])
    assert.equal(db.state.claimWrites[0].tier, 'free')
  }

  const live = paidCharge('ch_live', 'in_live')
  const liveInvoice = invoiceFor('in_live', 'sub_kbo', live, PERIOD)
  const old = paidCharge('ch_old', 'in_old')
  const oldInvoice = invoiceFor('in_old', 'sub_kbo', old, PREVIOUS)
  const liveSub = plan('sub_kbo', KBO, PERIOD, liveInvoice)
  const kept = mockDb()
  const keep = await handleDisputeEvent({
    type: 'charge.dispute.created',
    data: { object: { id: 'dp_old', charge: 'ch_old', status: 'needs_response' } },
  }, {
    stripe: entitlementStripe({
      subs: [liveSub],
      charges: [live, old],
      invoices: { in_old: oldInvoice, in_live: liveInvoice },
    }),
    supabase: kept,
  })
  assert.equal(keep, null)
  assert.equal(kept.state.upserts.length, 0)
})

test('a won dispute recomputes and restores an active subscription', async () => {
  const charge = paidCharge('ch_won', 'in_won', { disputed: true, dispute_status: 'won' })
  const invoice = invoiceFor('in_won', 'sub_won', charge, PERIOD)
  const sub = plan('sub_won', KBO, PERIOD, invoice)
  const db = mockDb()
  db.state.metadata.tier = 'free'
  const failure = await handleDisputeEvent({
    type: 'charge.dispute.closed',
    data: { object: { id: 'dp_won', status: 'won', charge: 'ch_won' } },
  }, {
    stripe: entitlementStripe({ subs: [sub], charges: [charge], invoices: { in_won: invoice } }),
    supabase: db,
  })
  assert.equal(failure, null)
  assert.equal(db.state.upserts.at(-1).tier, 'kbo')
  assert.equal(db.state.claimWrites.at(-1).tier, 'kbo')

  const closed = mockDb()
  const lost = await handleDisputeEvent({
    type: 'charge.dispute.closed',
    data: { object: { id: 'dp_lost', status: 'lost', charge: 'ch_won' } },
  }, { stripe: entitlementStripe(), supabase: closed })
  assert.equal(lost, null)
  assert.equal(closed.state.upserts.length, 0)
})

test('a charge with no customer falls back to billing email, then receipt email', async () => {
  const lifetime = {
    id: 'ch_life',
    customer: null,
    amount: 9999,
    amount_refunded: 9999,
    refunded: true,
    paid: true,
    disputed: false,
    metadata: { cg_plan: 'lifetime' },
    billing_details: { email: EMAIL },
  }
  const billing = mockDb()
  const billed = await handleChargeRefunded(lifetime, {
    stripe: entitlementStripe({ charges: [lifetime] }),
    supabase: billing,
  })
  assert.equal(billed, null)
  assert.deepEqual(billing.state.upserts, [{ id: 'user-1', tier: 'free' }])

  const receiptCharge = {
    ...lifetime,
    id: 'ch_receipt',
    billing_details: { email: '' },
    receipt_email: EMAIL,
  }
  const receipt = mockDb()
  const received = await handleChargeRefunded(receiptCharge, {
    stripe: entitlementStripe({ charges: [receiptCharge] }),
    supabase: receipt,
  })
  assert.equal(received, null)
  assert.equal(receipt.state.upserts.at(-1).tier, 'free')

  const blank = mockDb()
  const missing = await handleChargeRefunded({
    ...lifetime,
    id: 'ch_blank',
    billing_details: { email: '  ' },
    receipt_email: '',
  }, { stripe: entitlementStripe(), supabase: blank })
  assert.equal(missing, null)
  assert.equal(blank.state.upserts.length, 0)

  const disputeDb = mockDb()
  const disputed = await handleDisputeEvent({
    type: 'charge.dispute.created',
    data: { object: { id: 'dp_mail', charge: 'ch_life', status: 'needs_response' } },
  }, {
    stripe: entitlementStripe({
      charges: [{ ...lifetime, id: 'ch_life', refunded: false, amount_refunded: 0, disputed: true }],
    }),
    supabase: disputeDb,
  })
  assert.equal(disputed, null)
  assert.equal(disputeDb.state.upserts.at(-1).tier, 'free')
})

test('no matching user logs and returns success', async () => {
  const db = mockDb()
  db.state.missingUser = true
  const current = refundedCharge('ch_full', 'in_kbo')
  const planState = kboPlan(current)
  const failure = await handleChargeRefunded(current, {
    stripe: entitlementStripe({ subs: [planState.sub], charges: [current] }),
    supabase: db,
  })
  assert.equal(failure, null)
  assert.equal(db.state.upserts.length, 0)
})

test('a user lookup error returns 500 and does not revoke', async () => {
  const db = mockDb()
  db.state.listError = { message: 'auth timeout' }
  const current = refundedCharge('ch_full', 'in_kbo')
  const planState = kboPlan(current)
  const failure = await handleChargeRefunded(current, {
    stripe: entitlementStripe({ subs: [planState.sub], charges: [current] }),
    supabase: db,
  })
  assert.equal(failure.status, 500)
  assert.deepEqual(failure.body, { error: 'user lookup failed' })
  assert.equal(JSON.stringify(failure.body).includes(EMAIL), false)
  assert.equal(db.state.upserts.length, 0)
  assert.equal(db.state.claimWrites.length, 0)

  const byEmail = await clearTierByEmail(EMAIL, { stripe: entitlementStripe(), supabase: db })
  assert.equal(byEmail.status, 500)
  assert.deepEqual(byEmail.body, { error: 'user lookup failed' })
})

test('a failed profile or claim write returns 5xx and the retry is safe', async () => {
  const db = mockDb()
  const current = refundedCharge('ch_full', 'in_kbo')
  const planState = kboPlan(current)
  const stripe = entitlementStripe({ subs: [planState.sub], charges: [current] })
  db.state.upsertError = { message: 'db down' }
  const profileFailed = await handleChargeRefunded(current, { stripe, supabase: db })
  assert.equal(profileFailed.status, 500)
  assert.deepEqual(profileFailed.body, { error: 'tier update failed' })
  assert.equal(JSON.stringify(profileFailed.body).includes(EMAIL), false)
  assert.equal(db.state.claimWrites.length, 0)

  db.state.upsertError = null
  db.state.claimError = { message: 'auth down' }
  const claimFailed = await handleChargeRefunded(current, { stripe, supabase: db })
  assert.equal(claimFailed.status, 500)
  assert.deepEqual(claimFailed.body, { error: 'tier claim failed' })
  assert.equal(db.state.claimWrites.length, 1)

  db.state.claimError = null
  const retried = await handleChargeRefunded(current, { stripe, supabase: db })
  assert.equal(retried, null)
  assert.equal(db.state.metadata.tier, 'free')
  assert.equal(db.state.metadata.provider, 'email')

  const claimWrites = db.state.claimWrites.length
  const again = await handleChargeRefunded(current, { stripe, supabase: db })
  assert.equal(again, null)
  assert.equal(db.state.claimWrites.length, claimWrites)
  assert.ok(db.state.upserts.every((row) => row.id === 'user-1'))
})

test('clearTierByCustomer returns 5xx when the profile upsert fails', async () => {
  const db = mockDb()
  db.state.upsertError = { message: 'db down' }
  const failure = await clearTierByCustomer('cus_1', { stripe: entitlementStripe(), supabase: db })
  assert.equal(failure.status, 500)
  assert.deepEqual(failure.body, { error: 'tier update failed' })
  assert.equal(JSON.stringify(failure.body).includes(EMAIL), false)
  assert.equal(db.state.claimWrites.length, 0)

  db.state.upsertError = null
  const retried = await clearTierByCustomer('cus_1', { stripe: entitlementStripe(), supabase: db })
  assert.equal(retried, null)
  assert.equal(db.state.upserts.at(-1).tier, 'free')
  assert.equal(db.state.metadata.tier, 'free')
})

test('a Stripe read error returns 500 and does not change the tier', async () => {
  const db = mockDb()
  const current = refundedCharge('ch_full', 'in_kbo')
  const planState = kboPlan(current)
  const stripe = entitlementStripe({ subs: [planState.sub], charges: [current], invoices: { in_kbo: planState.invoice } })
  stripe.invoices.retrieve = async () => {
    throw Object.assign(new Error('stripe down'), { type: 'StripeAPIError' })
  }
  const failure = await handleChargeRefunded(current, { stripe, supabase: db })
  assert.equal(failure.status, 500)
  assert.deepEqual(failure.body, { error: 'stripe read failed' })
  assert.equal(JSON.stringify(failure.body).includes(EMAIL), false)
  assert.equal(db.state.upserts.length, 0)
  assert.equal(db.state.claimWrites.length, 0)

  const dropped = mockDb()
  const lifetime = {
    id: 'ch_life',
    customer: 'cus_1',
    paid: true,
    amount: 9999,
    refunded: false,
    disputed: false,
    metadata: { cg_plan: 'lifetime' },
  }
  const accessStripe = entitlementStripe({ charges: [lifetime] })
  accessStripe.charges.list = async () => {
    throw Object.assign(new Error('stripe down'), { type: 'StripeAPIError' })
  }
  const accessFailed = await clearTierByCustomer('cus_1', { stripe: accessStripe, supabase: dropped })
  assert.equal(accessFailed.status, 500)
  assert.deepEqual(accessFailed.body, { error: 'stripe read failed' })
  assert.equal(dropped.state.upserts.length, 0)
  assert.equal(dropped.state.metadata.tier, 'combined')
})

test('the email lookup finds the member on the second user page', async () => {
  const db = mockDb()
  db.state.missingUser = true
  const others = Array.from({ length: 1000 }, (_, i) => ({
    id: `other-${i}`,
    email: `other-${i}@example.com`,
  }))
  db.auth.admin.listUsers = async ({ page }) => {
    if (page === 1) return { data: { users: others } }
    return {
      data: {
        users: [{ id: 'user-1', email: EMAIL, app_metadata: { provider: 'email', tier: 'combined' } }],
      },
    }
  }
  const lifetime = {
    id: 'ch_life',
    customer: 'cus_1',
    amount: 9999,
    amount_refunded: 9999,
    refunded: true,
    paid: true,
    disputed: false,
    metadata: { cg_plan: 'lifetime' },
  }
  const failure = await handleChargeRefunded(lifetime, {
    stripe: entitlementStripe({ charges: [lifetime] }),
    supabase: db,
  })
  assert.equal(failure, null)
  assert.deepEqual(db.state.upserts, [{ id: 'user-1', tier: 'free' }])
  assert.equal(db.state.claimWrites[0].tier, 'free')
  assert.equal(db.state.claimWrites[0].provider, 'email')
})

test('a taxed lifetime refund reads invoice payments, and a Stripe error returns 500', async () => {
  const charge = {
    id: 'ch_tax',
    customer: 'cus_1',
    amount: 26749,
    amount_refunded: 26749,
    refunded: true,
    paid: true,
    disputed: false,
    payment_intent: 'pi_tax',
  }
  const stripe = entitlementStripe({ charges: [charge] })
  stripe.invoicePayments.list = async () => ({
    data: [{
      invoice: {
        id: 'in_tax',
        lines: { data: [{ price: { id: 'price_1UPJ78PwL0k9PEMvnZPU3k5a' } }] },
      },
    }],
  })
  const db = mockDb()
  const failure = await handleChargeRefunded(charge, { stripe, supabase: db })
  assert.equal(failure, null)
  assert.equal(db.state.upserts.at(-1).tier, 'free')
  assert.equal(charge.invoice, undefined)

  const broken = entitlementStripe({ charges: [charge] })
  broken.invoicePayments.list = async () => {
    throw Object.assign(new Error('stripe down'), { type: 'StripeAPIError' })
  }
  const kept = mockDb()
  const blocked = await handleChargeRefunded(charge, { stripe: broken, supabase: kept })
  assert.equal(blocked.status, 500)
  assert.deepEqual(blocked.body, { error: 'stripe read failed' })
  assert.equal(kept.state.upserts.length, 0)
  assert.equal(kept.state.metadata.tier, 'combined')

  const recompute = entitlementStripe({
    charges: [{ ...charge, refunded: false, amount_refunded: 0 }],
  })
  recompute.invoicePayments.list = async () => {
    throw Object.assign(new Error('stripe down'), { type: 'StripeAPIError' })
  }
  const member = mockDb()
  const dropped = await clearTierByCustomer('cus_1', { stripe: recompute, supabase: member })
  assert.equal(dropped.status, 500)
  assert.deepEqual(dropped.body, { error: 'stripe read failed' })
  assert.equal(member.state.upserts.length, 0)
  assert.equal(member.state.metadata.tier, 'combined')
})

test('charges.list keeps a lifetime charge that is past the first page', async () => {
  const filler = Array.from({ length: 50 }, (_, i) => ({
    id: `ch_${i}`,
    paid: true,
    amount: 100,
    refunded: false,
    disputed: false,
  }))
  const lifetime = {
    id: 'ch_life_page2',
    paid: true,
    refunded: false,
    amount: 9999,
    disputed: false,
    metadata: { cg_plan: 'lifetime' },
  }
  const stripe = entitlementStripe()
  let calls = 0
  stripe.charges.list = async ({ starting_after } = {}) => {
    calls += 1
    if (!starting_after) return { data: filler, has_more: true }
    return { data: [lifetime], has_more: false }
  }
  const synced = await accessAfterSyncRecompute(stripe, EMAIL, 'free')
  assert.equal(calls, 2)
  assert.equal(synced.tier, 'combined')
})

test('a checkout charge read error does not re-grant a lifetime session', async () => {
  const session = {
    mode: 'payment',
    payment_status: 'paid',
    customer_details: { email: EMAIL },
    payment_intent: 'pi_life',
    metadata: { cg_plan: 'lifetime' },
    line_items: { data: [{ price: { id: 'price_1UPJ78PwL0k9PEMvnZPU3k5a' } }] },
  }
  const broken = {
    paymentIntents: {
      async retrieve() {
        throw Object.assign(new Error('stripe down'), { type: 'StripeAPIError' })
      },
    },
  }
  assert.equal(await sessionGrantsLifetime(broken, session), false)

  const refunded = {
    paymentIntents: {
      async retrieve() {
        return {
          latest_charge: {
            id: 'ch_life',
            paid: true,
            refunded: true,
            amount: 9999,
            amount_refunded: 9999,
            disputed: false,
          },
        }
      },
    },
  }
  assert.equal(await sessionGrantsLifetime(refunded, session), false)

  const unread = {
    paymentIntents: {
      async retrieve() {
        return { id: 'pi_life', latest_charge: 'ch_life' }
      },
    },
    charges: {
      async retrieve() {
        throw Object.assign(new Error('stripe down'), { type: 'StripeAPIError' })
      },
    },
  }
  assert.equal(await sessionGrantsLifetime(unread, session), false)

  const clear = {
    paymentIntents: {
      async retrieve() {
        return {
          latest_charge: {
            id: 'ch_clear',
            paid: true,
            refunded: false,
            amount: 9999,
            disputed: false,
          },
        }
      },
    },
  }
  assert.equal(await sessionGrantsLifetime(clear, session), true)
})

test('a Stripe price lookup error on the webhook returns 500', async () => {
  const sub = plan('sub_unknown', 'price_unknown_live', PERIOD, null)
  const stripe = entitlementStripe({ subs: [sub] })
  stripe.prices = {
    async retrieve() {
      throw Object.assign(new Error('stripe down'), { type: 'StripeAPIError' })
    },
  }
  const db = mockDb()
  const failure = await clearTierByCustomer('cus_1', { stripe, supabase: db })
  assert.equal(failure.status, 500)
  assert.deepEqual(failure.body, { error: 'stripe read failed' })
  assert.equal(JSON.stringify(failure.body).includes(EMAIL), false)
  assert.equal(db.state.upserts.length, 0)
  assert.equal(db.state.claimWrites.length, 0)
  assert.equal(db.state.metadata.tier, 'combined')
})

// Unit tests for case-insensitive Stripe entitlement lookup.
// No network, no credentials. Run: npm run test:api
import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  DISCORD_MONTHLY_PRICE_ID,
  DISCORD_ONLY_PRODUCT_ID,
  DISCORD_WEEKLY_PRICE_ID,
  LIFETIME_AMOUNT,
  computeStripeAccess,
  computeStripeTier,
  customersForEmail,
  isDiscordPrice,
  mergeTier,
  resolvePurchaseTier,
  planForAmount,
  planForCheckout,
  planForPriceId,
  signalsLifetimePurchase,
  tierForPrice,
  tierForStripePrice,
} from '../api/_stripeTier.js'

const WEEKLY = 'price_1TtFErPwL0k9PEMvIrEJajK1'
const MONTHLY = 'price_1TtFFePwL0k9PEMvPJUUwuTr'
const LEGACY_KBO = 'price_1THCokPwL0k9PEMvcWwT7F2c'

function customer(id, email) {
  return { id, email }
}

function sub(priceId, status = 'active', metadata) {
  return { id: `sub_${priceId}_${status}`, status, metadata, items: { data: [{ price: { id: priceId } }] } }
}

const DISCORD_WEEKLY = 'price_discord_weekly_test'
const DISCORD_MONTHLY = 'price_discord_monthly_test'
const DISCORD_ENV = {
  STRIPE_PRICE_DISCORD_WEEKLY: DISCORD_WEEKLY,
  STRIPE_PRICE_DISCORD_MONTHLY: DISCORD_MONTHLY,
}

function mockStripe({ listByEmail = {}, searchByQuery = {}, subsByCustomer = {}, chargesByCustomer = {}, invoicesById = {}, pricesById = {}, sessionsByPaymentIntent = {} } = {}) {
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
    invoices: {
      async retrieve(id) {
        calls.push({ op: 'invoice', id })
        return invoicesById[id] || { lines: { data: [] } }
      },
    },
    invoicePayments: {
      async list({ payment } = {}) {
        const paymentIntent = payment?.payment_intent || ''
        calls.push({ op: 'invoicePayments', paymentIntent })
        const invoiceId = paymentIntent.startsWith('pi_') ? paymentIntent.slice(3) : ''
        const invoice = invoicesById[invoiceId]
        if (!invoice) return { data: [] }
        return { data: [{ id: `inpay_${invoiceId}`, invoice: { id: invoiceId, ...invoice } }] }
      },
    },
    prices: {
      async retrieve(id) {
        calls.push({ op: 'price', id })
        if (!pricesById[id]) throw new Error('missing price')
        return pricesById[id]
      },
    },
    checkout: {
      sessions: {
        async list({ payment_intent: paymentIntent }) {
          calls.push({ op: 'sessions', paymentIntent })
          return { data: sessionsByPaymentIntent[paymentIntent] || [] }
        },
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

test('pause_collection keeps access while the subscription stays active', async () => {
  const paused = {
    ...sub(WEEKLY),
    pause_collection: { behavior: 'void', resumes_at: 1_900_000_000 },
  }
  const stripe = mockStripe({
    listByEmail: { 'fan@example.com': [customer('cus_pause', 'fan@example.com')] },
    subsByCustomer: { cus_pause: [paused] },
  })
  assert.equal(await computeStripeTier(stripe, 'fan@example.com'), 'combined')
})

test('canceled subscriptions do not grant access', async () => {
  const stripe = mockStripe({
    listByEmail: { 'fan@example.com': [customer('cus_old', 'fan@example.com')] },
    subsByCustomer: { cus_old: [sub(WEEKLY, 'canceled'), sub(WEEKLY, 'past_due')] },
  })
  assert.equal(await computeStripeTier(stripe, 'fan@example.com'), 'free')
})

test('discord-only prices never grant site access and cannot capture a known price', () => {
  assert.equal(tierForPrice(DISCORD_WEEKLY, DISCORD_ENV), 'discord')
  assert.equal(tierForPrice(DISCORD_MONTHLY, DISCORD_ENV), 'discord')
  assert.equal(tierForPrice('price_brand_new'), 'combined')
  assert.equal(isDiscordPrice(WEEKLY, { STRIPE_PRICE_DISCORD_WEEKLY: WEEKLY }), false)
  assert.equal(tierForPrice(WEEKLY, { STRIPE_PRICE_DISCORD_WEEKLY: WEEKLY }), 'combined')
  assert.equal(tierForPrice(LEGACY_KBO, { STRIPE_PRICE_DISCORD_MONTHLY: LEGACY_KBO }), 'kbo')
  assert.equal(resolvePurchaseTier({ priceId: 'price_missing', metadata: { cg_plan: 'discord_weekly' } }), 'discord')
  assert.equal(resolvePurchaseTier({ priceId: WEEKLY, metadata: { cg_plan: 'discord_monthly' } }), 'discord')
  assert.equal(resolvePurchaseTier({ priceId: WEEKLY, metadata: { cg_plan: 'weekly' } }), 'combined')
  assert.equal(mergeTier('free', 'discord'), 'discord')
  assert.equal(mergeTier('discord', 'discord'), 'discord')
  assert.equal(mergeTier('discord', 'combined'), 'combined')
  assert.equal(mergeTier('discord', 'kbo'), 'kbo')
  assert.equal(mergeTier('combined', 'discord'), 'combined')
  assert.equal(mergeTier('kbo', 'discord'), 'kbo')
  assert.equal(mergeTier('monthly', 'discord'), 'monthly')
  assert.equal(mergeTier('owner', 'discord'), 'owner')
})

test('a discord-only subscription does not unlock the site', async () => {
  const stripe = mockStripe({
    listByEmail: { 'fan@example.com': [customer('cus_d', 'fan@example.com')] },
    subsByCustomer: { cus_d: [sub(DISCORD_WEEKLY)] },
  })
  const access = await computeStripeAccess(stripe, 'fan@example.com', DISCORD_ENV)
  assert.deepEqual(access, { tier: 'discord', discordOnly: true })
  assert.equal(await computeStripeTier(stripe, 'fan@example.com', DISCORD_ENV), 'discord')
})

test('discord-only plus all-access keeps site access and the discord flag', async () => {
  const stripe = mockStripe({
    listByEmail: { 'fan@example.com': [customer('cus_both', 'fan@example.com')] },
    subsByCustomer: { cus_both: [sub(DISCORD_WEEKLY), sub(MONTHLY)] },
  })
  const access = await computeStripeAccess(stripe, 'fan@example.com', DISCORD_ENV)
  assert.equal(access.tier, 'combined')
  assert.equal(access.discordOnly, true)
})

test('a discord subscription tagged only in metadata does not grant site access', async () => {
  const stripe = mockStripe({
    listByEmail: { 'fan@example.com': [customer('cus_meta', 'fan@example.com')] },
    subsByCustomer: { cus_meta: [sub('price_not_in_env', 'active', { cg_plan: 'discord_weekly' })] },
  })
  const access = await computeStripeAccess(stripe, 'fan@example.com', {})
  assert.deepEqual(access, { tier: 'discord', discordOnly: true })
})

test('a canceled discord subscription does not keep the discord tier', async () => {
  const stripe = mockStripe({
    listByEmail: { 'fan@example.com': [customer('cus_old', 'fan@example.com')] },
    subsByCustomer: { cus_old: [sub(DISCORD_WEEKLY, 'canceled')] },
  })
  const access = await computeStripeAccess(stripe, 'fan@example.com', DISCORD_ENV)
  assert.deepEqual(access, { tier: 'free', discordOnly: false })
})

test('lifetime still grants combined, including next to a discord subscription', async () => {
  const stripe = mockStripe({
    listByEmail: { 'fan@example.com': [customer('cus_life', 'fan@example.com')] },
    subsByCustomer: { cus_life: [sub(DISCORD_MONTHLY)] },
    chargesByCustomer: { cus_life: [{ paid: true, refunded: false, amount: LIFETIME_AMOUNT }] },
  })
  const access = await computeStripeAccess(stripe, 'fan@example.com', DISCORD_ENV)
  assert.equal(access.tier, 'combined')
  assert.equal(access.discordOnly, true)
})

test('a $99.99 discord charge is not treated as lifetime', async () => {
  const stripe = mockStripe({
    listByEmail: { 'fan@example.com': [customer('cus_d', 'fan@example.com')] },
    chargesByCustomer: {
      cus_d: [{ paid: true, refunded: false, amount: LIFETIME_AMOUNT, payment_intent: 'pi_in_discord', metadata: { cg_plan: 'discord_monthly' } }],
    },
    invoicesById: {
      in_discord: { lines: { data: [{ price: { id: DISCORD_MONTHLY } }] } },
    },
  })
  const access = await computeStripeAccess(stripe, 'fan@example.com', DISCORD_ENV)
  assert.equal(access.tier, 'free')
  assert.equal(access.discordOnly, false)

  const byInvoice = mockStripe({
    listByEmail: { 'fan@example.com': [customer('cus_d', 'fan@example.com')] },
    chargesByCustomer: {
      cus_d: [{ paid: true, refunded: false, amount: LIFETIME_AMOUNT, payment_intent: 'pi_in_discord' }],
    },
    invoicesById: {
      in_discord: { lines: { data: [{ price: { id: DISCORD_WEEKLY } }] } },
    },
  })
  assert.equal((await computeStripeAccess(byInvoice, 'fan@example.com', DISCORD_ENV)).tier, 'free')
})

test('live discord price ids and product metadata never grant site access', async () => {
  assert.equal(tierForPrice(DISCORD_WEEKLY_PRICE_ID, {}), 'discord')
  assert.equal(tierForPrice(DISCORD_MONTHLY_PRICE_ID, {}), 'discord')
  assert.equal(isDiscordPrice(DISCORD_WEEKLY_PRICE_ID, {}), true)
  assert.equal(resolvePurchaseTier({
    priceId: 'price_other',
    price: { id: 'price_other', product: DISCORD_ONLY_PRODUCT_ID },
  }), 'discord')
  assert.equal(resolvePurchaseTier({
    price: { id: 'price_other', product: { id: 'prod_other', metadata: { tier: 'discord_only' } } },
  }), 'discord')
  assert.equal(resolvePurchaseTier({ priceId: WEEKLY, metadata: { tier: 'discord_only' } }), 'discord')
  assert.equal(resolvePurchaseTier({ priceId: WEEKLY }), 'combined')

  const byProduct = mockStripe({
    listByEmail: { 'fan@example.com': [customer('cus_p', 'fan@example.com')] },
    subsByCustomer: {
      cus_p: [{
        id: 'sub_prod',
        status: 'active',
        items: { data: [{ price: { id: 'price_unknown_discord', product: DISCORD_ONLY_PRODUCT_ID } }] },
      }],
    },
  })
  assert.deepEqual(await computeStripeAccess(byProduct, 'fan@example.com', {}), { tier: 'discord', discordOnly: true })
  assert.equal(byProduct.calls.some((c) => c.op === 'price'), false)

  const byMetadata = mockStripe({
    pricesById: {
      price_meta_only: {
        id: 'price_meta_only',
        product: { id: 'prod_other', metadata: { tier: 'discord_only' } },
      },
    },
  })
  assert.equal(await tierForStripePrice(byMetadata, { id: 'price_meta_only' }), 'discord')
  assert.equal(byMetadata.calls.some((c) => c.op === 'price' && c.id === 'price_meta_only'), true)

  const site = mockStripe()
  assert.equal(await tierForStripePrice(site, { id: WEEKLY, product: 'prod_all_access' }), 'combined')
  assert.equal(site.calls.some((c) => c.op === 'price'), false)

  const broken = mockStripe()
  assert.equal(await tierForStripePrice(broken, { id: 'price_unknown_live' }), 'combined')
  await assert.rejects(
    () => tierForStripePrice(broken, { id: 'price_unknown_live' }, { strict: true }),
    /missing price/,
  )
})

test('a $99.99 charge on the discord product is not lifetime', async () => {
  const stripe = mockStripe({
    listByEmail: { 'fan@example.com': [customer('cus_d', 'fan@example.com')] },
    chargesByCustomer: {
      cus_d: [{ paid: true, refunded: false, amount: LIFETIME_AMOUNT, payment_intent: 'pi_in_prod' }],
    },
    invoicesById: {
      in_prod: { lines: { data: [{ price: { id: 'price_unknown', product: DISCORD_ONLY_PRODUCT_ID } }] } },
    },
  })
  const access = await computeStripeAccess(stripe, 'fan@example.com', {})
  assert.equal(access.tier, 'free')
  assert.equal(access.discordOnly, false)
})

test('a $99.99 charge on the lifetime price still grants combined', async () => {
  const stripe = mockStripe({
    listByEmail: { 'fan@example.com': [customer('cus_life', 'fan@example.com')] },
    chargesByCustomer: {
      cus_life: [{ paid: true, refunded: false, amount: LIFETIME_AMOUNT, payment_intent: 'pi_in_life' }],
    },
    invoicesById: {
      in_life: { lines: { data: [{ price: { id: 'price_1THZjaPwL0k9PEMvARtuGG1F' } }] } },
    },
  })
  assert.equal(await computeStripeTier(stripe, 'fan@example.com', DISCORD_ENV), 'combined')
})

const NEW_LIFETIME = 'price_1UPJ78PwL0k9PEMvnZPU3k5a'
const YEARLY = 'price_1UPJ7DPwL0k9PEMv2Z9Ca8B5'
const FOUNDERS = 'price_1THZjaPwL0k9PEMvARtuGG1F'
const KBO_YEARLY = 'price_1THCpZPwL0k9PEMvPlLqiIDu'

test('lifetime, founders, and yearly price ids grant combined; the old yearly price stays kbo', () => {
  assert.equal(tierForPrice(NEW_LIFETIME), 'combined')
  assert.equal(tierForPrice(FOUNDERS), 'combined')
  assert.equal(tierForPrice(YEARLY), 'combined')
  assert.equal(tierForPrice(KBO_YEARLY), 'kbo')
  assert.equal(planForPriceId(YEARLY), 'yearly')
  assert.equal(planForPriceId(NEW_LIFETIME), 'lifetime')
  assert.equal(planForPriceId(FOUNDERS), 'lifetime')
  assert.equal(signalsLifetimePurchase({ priceId: NEW_LIFETIME }), true)
  assert.equal(signalsLifetimePurchase({ priceId: YEARLY, price: { id: YEARLY, type: 'recurring', recurring: { interval: 'year' } } }), false)
  assert.equal(signalsLifetimePurchase({
    priceId: 'price_custom',
    price: { id: 'price_custom', type: 'one_time', metadata: { tier: 'combined' } },
  }), true)
  assert.equal(signalsLifetimePurchase({ product: 'prod_UG5v4BQ2Mo0wie' }), true)
})

test('env price ids grant combined and stay site plans if a discord env var points at them', () => {
  const env = {
    STRIPE_PRICE_LIFETIME: 'price_newLifeEnv',
    STRIPE_PRICE_YEARLY: 'price_yearEnv',
    STRIPE_PRICE_FOUNDERS: 'price_foundersEnv',
    STRIPE_PRICE_DISCORD_WEEKLY: 'price_newLifeEnv',
  }
  assert.equal(tierForPrice('price_newLifeEnv', env), 'combined')
  assert.equal(tierForPrice('price_yearEnv', env), 'combined')
  assert.equal(tierForPrice('price_foundersEnv', env), 'combined')
  assert.equal(isDiscordPrice('price_newLifeEnv', env), false)
  assert.equal(tierForPrice(KBO_YEARLY, env), 'kbo')
})

test('a taxed lifetime charge grants combined by price id', async () => {
  const stripe = mockStripe({
    listByEmail: { 'fan@example.com': [customer('cus_life', 'fan@example.com')] },
    chargesByCustomer: {
      cus_life: [{ paid: true, refunded: false, amount: 26749, payment_intent: 'pi_in_new' }],
    },
    invoicesById: {
      in_new: { lines: { data: [{ price: { id: NEW_LIFETIME, product: 'prod_UG5v4BQ2Mo0wie' } }] } },
    },
  })
  assert.equal(await computeStripeTier(stripe, 'fan@example.com'), 'combined')
})

test('a taxed founders charge grants combined by the shared lifetime price id', async () => {
  const stripe = mockStripe({
    listByEmail: { 'fan@example.com': [customer('cus_life', 'fan@example.com')] },
    chargesByCustomer: {
      cus_life: [{ paid: true, refunded: false, amount: 10724, payment_intent: 'pi_in_founders' }],
    },
    invoicesById: {
      in_founders: { lines: { data: [{ price: { id: FOUNDERS } }] } },
    },
  })
  assert.equal(await computeStripeTier(stripe, 'fan@example.com'), 'combined')
})

test('the lifetime product id grants combined when the price id is unrecognized', async () => {
  const stripe = mockStripe({
    listByEmail: { 'fan@example.com': [customer('cus_life', 'fan@example.com')] },
    chargesByCustomer: {
      cus_life: [{ paid: true, refunded: false, amount: 26000, payment_intent: 'pi_in_prod' }],
    },
    invoicesById: {
      in_prod: { lines: { data: [{ price: { id: 'price_not_listed', product: 'prod_UG5v4BQ2Mo0wie' } }] } },
    },
  })
  assert.equal(await computeStripeTier(stripe, 'fan@example.com'), 'combined')
})

test('a taxed charge with no price attached does not use the legacy amount fallback', async () => {
  const stripe = mockStripe({
    listByEmail: { 'fan@example.com': [customer('cus_life', 'fan@example.com')] },
    chargesByCustomer: {
      cus_life: [{ paid: true, refunded: false, amount: 10724 }],
    },
  })
  assert.equal(await computeStripeTier(stripe, 'fan@example.com'), 'free')
})

test('a checkout session on the payment intent grants lifetime without an invoice', async () => {
  const stripe = mockStripe({
    listByEmail: { 'fan@example.com': [customer('cus_life', 'fan@example.com')] },
    chargesByCustomer: {
      cus_life: [{ paid: true, refunded: false, amount: 26749, payment_intent: 'pi_life' }],
    },
    sessionsByPaymentIntent: {
      pi_life: [{
        id: 'cs_test_lifetime1234',
        metadata: { cg_plan: 'lifetime' },
        line_items: { data: [{ price: { id: NEW_LIFETIME } }] },
      }],
    },
  })
  assert.equal(await computeStripeTier(stripe, 'fan@example.com'), 'combined')
})

test('a yearly subscription grants combined and a yearly invoice charge is not lifetime', async () => {
  const subscribed = mockStripe({
    listByEmail: { 'fan@example.com': [customer('cus_year', 'fan@example.com')] },
    subsByCustomer: { cus_year: [sub(YEARLY)] },
  })
  assert.equal(await computeStripeTier(subscribed, 'fan@example.com'), 'combined')

  const chargeOnly = mockStripe({
    listByEmail: { 'fan@example.com': [customer('cus_year', 'fan@example.com')] },
    chargesByCustomer: {
      cus_year: [{ paid: true, refunded: false, amount: 16049, payment_intent: 'pi_in_year' }],
    },
    invoicesById: {
      in_year: { lines: { data: [{ price: { id: YEARLY, type: 'recurring', recurring: { interval: 'year' }, metadata: { tier: 'combined' } } }] } },
    },
  })
  assert.equal(await computeStripeTier(chargeOnly, 'fan@example.com'), 'free')
})

test('planForCheckout uses the price id when sales tax changes the total', () => {
  assert.equal(planForCheckout({
    amount_total: 16049,
    line_items: { data: [{ price: { id: YEARLY } }] },
  }), 'yearly')
  assert.equal(planForCheckout({
    amount_total: 26749,
    metadata: { cg_plan: 'lifetime' },
  }), 'lifetime')
  assert.equal(planForCheckout({
    amount_total: 10724,
    metadata: { cg_plan: 'founders' },
  }), 'founders')
  assert.equal(planForAmount(14999), 'yearly')
  assert.equal(planForAmount(24999), 'lifetime')
})

test('quotes in an email are escaped in the search query', async () => {
  const stripe = mockStripe()
  await customersForEmail(stripe, 'a"b@example.com')
  assert.equal(stripe.calls.find((c) => c.op === 'search').query, 'email:"a\\"b@example.com"')
})

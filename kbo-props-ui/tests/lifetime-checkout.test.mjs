import assert from 'node:assert/strict'
import { test } from 'node:test'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { handleOfferCheckoutRequest } from '../api/_offerCheckout.js'
import checkoutHandler, { CHECKOUT_ACTIONS } from '../api/checkout/[action].js'
import { lifetimePriceIds, tierForPrice } from '../api/_stripeTier.js'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const LIFETIME = 'price_1UPJ78PwL0k9PEMvnZPU3k5a'
const LEGACY_99 = 'price_1THZjaPwL0k9PEMvARtuGG1F'

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

function mockStripe() {
  const calls = []
  return {
    calls,
    customers: { async list() { return { data: [], has_more: false } }, async search() { return { data: [] } } },
    checkout: {
      sessions: {
        async create(params) {
          calls.push(params)
          return { id: 'cs_test_created123', url: 'https://checkout.stripe.com/c/pay/cs_test_created123' }
        },
      },
    },
  }
}

async function post(deps = {}) {
  const res = mockRes()
  const stripe = mockStripe()
  await handleOfferCheckoutRequest({ method: 'POST', headers: {}, body: { utm_source: 'x' } }, res,
    { stripe, env: {}, user: null, ...deps })
  return { res, params: stripe.calls[0], calls: stripe.calls }
}

test('lifetime checkout always uses the $249.99 price with no trial', async () => {
  const { res, params } = await post()
  assert.equal(res.statusCode, 200)
  assert.equal(res.body.plan, 'lifetime')
  assert.equal(res.body.fallback, false)
  assert.equal(params.line_items[0].price, LIFETIME)
  assert.equal(params.mode, 'payment')
  assert.equal(params.subscription_data, undefined)
  assert.equal(params.metadata.cg_plan, 'lifetime')
})

test('a founders plan request can no longer open the $99.99 price', async () => {
  const { params } = await post({ plan: 'founders' })
  assert.equal(params.line_items[0].price, LIFETIME)
  assert.equal(params.metadata.cg_plan, 'lifetime')
  assert.equal(CHECKOUT_ACTIONS.founders, undefined)
  const res = mockRes()
  await checkoutHandler({ query: { action: 'founders' }, method: 'POST' }, res)
  assert.equal(res.statusCode, 404)
})

test('past $99.99 buyers keep All-Access', () => {
  assert.ok(lifetimePriceIds({}).includes(LEGACY_99))
  assert.equal(tierForPrice(LEGACY_99), 'combined')
})

function walk(dir, out = []) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name)
    if (statSync(p).isDirectory()) walk(p, out)
    else if (/\.(jsx?|mjs|css|html)$/.test(name)) out.push(p)
  }
  return out
}

test('the site no longer shows or links the Founders deal', () => {
  const files = [...walk(join(root, 'src')), ...walk(join(root, 'public')), join(root, 'scripts/publicPages.mjs')]
  const hits = []
  for (const file of files) {
    const text = readFileSync(file, 'utf8')
    // stripePrices.js keeps the archived price id (and says what it was) so past buyers keep access.
    const recognitionOnly = file.endsWith('src/stripePrices.js')
    for (const needle of [/founders/i, /\$99\.99/, /8x228t2tN5Mabzsf5C5Ne0b/, /plink_1UPJ7I/, /spots left/i, /checkout\/founders/]) {
      if (recognitionOnly && String(needle) === String(/\$99\.99/)) continue
      if (needle.test(text)) hits.push(`${file.slice(root.length + 1)} ${needle}`)
    }
    if (text.includes(LEGACY_99) && !recognitionOnly) hits.push(`${file.slice(root.length + 1)} ${LEGACY_99}`)
  }
  assert.deepEqual(hits, [])
})

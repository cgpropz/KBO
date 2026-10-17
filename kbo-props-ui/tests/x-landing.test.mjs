import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'
import { fileURLToPath } from 'node:url'
import { STRIPE_LINKS } from '../src/pricingTiers.js'
import { isXCampaignPath } from '../src/xCampaign.js'
import {
  DEFAULT_X_PIXEL_ID,
  DEFAULT_X_PURCHASE_EVENT_ID,
  pixelIdFromEnv,
  purchaseEventIdFromEnv,
} from '../src/xPixelIds.js'
import { applyXPixelHtml, xPixelSnippet } from '../scripts/xPixelSnippet.mjs'
import { resolveRequest } from '../scripts/staticRouter.mjs'
import { sitemapEntries } from '../scripts/kboSeoPage.mjs'

const uiRoot = fileURLToPath(new URL('..', import.meta.url))
const X_CTA = 'Unlock full boards: first week $4.99 with code XWEEK (auto-fills at checkout), then $9.99/wk, cancel anytime'

test('pixel and purchase ids default to the live X ads ids and a blank env loads nothing', () => {
  assert.equal(DEFAULT_X_PIXEL_ID, 'pul9k')
  assert.equal(DEFAULT_X_PURCHASE_EVENT_ID, 'tw-pul9k-pul9m')
  assert.equal(pixelIdFromEnv({}), 'pul9k')
  assert.equal(purchaseEventIdFromEnv({}), 'tw-pul9k-pul9m')
  assert.equal(pixelIdFromEnv({ VITE_X_PIXEL_ID: 'abc12' }), 'abc12')
  assert.equal(pixelIdFromEnv({ VITE_X_PIXEL_ID: '' }), '')
  assert.equal(purchaseEventIdFromEnv({ VITE_X_PURCHASE_EVENT_ID: '' }), '')
  assert.equal(xPixelSnippet(''), '')
  assert.equal(xPixelSnippet('pul9k').includes("twq('config'"), true)
  assert.equal(xPixelSnippet('bad id'), '')
})

test('the base snippet configures twq once and refuses a second uwt.js tag', () => {
  const snippet = xPixelSnippet('pul9k')
  assert.equal(snippet.split("twq('config'").length - 1, 1)
  assert.match(snippet, /if \(window\.__cgXPixelConfigured\) return/)
  assert.match(snippet, /script\[src\*="static\.ads-twitter\.com\/uwt\.js"\]/)
  assert.match(snippet, /https:\/\/static\.ads-twitter\.com\/uwt\.js/)
  const html = applyXPixelHtml('<head><!--x-pixel--></head>', {})
  assert.equal(html.split('__cgXPixelConfigured').length - 1, 3)
  assert.equal(applyXPixelHtml(html, {}), html)
  assert.equal(applyXPixelHtml('<head><!--x-pixel--></head>', { VITE_X_PIXEL_ID: ' ' }), '<head></head>')
})

test('/x is a noindex campaign page and is not in the sitemap', () => {
  assert.equal(isXCampaignPath('/x'), true)
  assert.equal(isXCampaignPath('/x/'), true)
  assert.equal(isXCampaignPath('/x.html'), true)
  assert.equal(isXCampaignPath('/'), false)
  assert.equal(isXCampaignPath('/pricing'), false)

  const html = readFileSync(new URL('../x.html', import.meta.url), 'utf8')
  assert.match(html, /<meta name="robots" content="noindex" \/>/)
  assert.match(html, /<title>Today's free top 3 \| CGPropz<\/title>/)
  assert.match(html, /name="description" content="Today's free top 3/)
  assert.match(html, /property="og:title" content="Today's free top 3 \| CGPropz"/)
  assert.match(html, /property="og:url" content="https:\/\/www\.cgpropz\.com\/x"/)
  assert.match(html, /rel="canonical" href="https:\/\/www\.cgpropz\.com\/x"/)
  assert.match(html, /<!--x-pixel-->/)
  assert.equal(html.includes('twq('), false)
  assert.equal(/\block\b/i.test(html), false)
  assert.equal(/guarantee/i.test(html), false)

  const config = JSON.parse(readFileSync(new URL('../vercel.json', import.meta.url), 'utf8'))
  const files = new Set(['/index.html', '/x.html', '/404.html'])
  const page = resolveRequest('/x', { files, config })
  assert.equal(page.status, 200)
  assert.equal(page.file, '/x.html')
  assert.equal(resolveRequest('/x.html', { files, config }).status, 308)
  assert.equal(sitemapEntries().some((entry) => entry.loc.endsWith('/x')), false)
})

test('the X landing reuses the free top 3 and the existing XWEEK checkout link', () => {
  const landing = readFileSync(new URL('../src/XLanding.jsx', import.meta.url), 'utf8')
  const app = readFileSync(new URL('../src/App.jsx', import.meta.url), 'utf8')
  assert.match(landing, /import FreePicksPreview from '\.\/FreePicksPreview'/)
  assert.equal(landing.includes(X_CTA), true)
  assert.match(landing, /STANDARD_LINE/)
  assert.match(landing, /prefetchWeeklyCheckoutUrl/)
  assert.match(landing, /campaignCheckoutHref/)
  assert.equal(/\block\b/i.test(landing), false)
  assert.match(app, /isXCampaignPath\(window\.location\.pathname\)/)
  assert.match(app, /<XLanding/)
  assert.equal(app.includes("destination: '/index.html'"), false)
})

test('campaign checkout carries every incoming query param onto the XWEEK flow', async () => {
  const memory = new Map()
  globalThis.localStorage = {
    getItem(key) { return memory.has(key) ? memory.get(key) : null },
    setItem(key, value) { memory.set(key, String(value)) },
    removeItem(key) { memory.delete(key) },
  }
  const sessionMemory = new Map()
  globalThis.sessionStorage = {
    getItem(key) { return sessionMemory.has(key) ? sessionMemory.get(key) : null },
    setItem(key, value) { sessionMemory.set(key, String(value)) },
    removeItem(key) { sessionMemory.delete(key) },
  }
  const events = []
  globalThis.window = {
    twq(...args) { events.push(args) },
  }

  const {
    campaignCheckoutHref,
    campaignUtm,
    captureAttribution,
    trackPurchaseOnce,
  } = await import('../src/tracking.js')

  memory.clear()
  const search = '?utm_source=x&utm_medium=paid&utm_campaign=x_ads&utm_term=nfl&utm_content=top3&twclid=click123&ref=ad'
  captureAttribution(search)
  const href = campaignCheckoutHref({ link: STRIPE_LINKS.weekly, user: null, search })
  const query = new URL(href).searchParams
  assert.equal(href.startsWith(STRIPE_LINKS.weekly), true)
  assert.equal(query.get('prefilled_promo_code'), null)
  assert.equal(query.get('utm_source'), 'x')
  assert.equal(query.get('utm_medium'), 'paid')
  assert.equal(query.get('utm_campaign'), 'x_ads')
  assert.equal(query.get('utm_content'), 'top3')
  assert.equal(query.get('twclid'), 'click123')
  assert.equal(query.get('ref'), 'ad')
  assert.deepEqual(campaignUtm(search), {
    utm_source: 'x',
    utm_medium: 'paid',
    utm_campaign: 'x_ads',
    utm_term: 'nfl',
    utm_content: 'top3',
  })

  const sessionUrl = 'https://checkout.stripe.com/c/pay/cs_live_weeklyxweek'
  const sessionHref = campaignCheckoutHref({
    link: STRIPE_LINKS.weekly,
    user: { id: 'user-1', email: 'buyer@example.com' },
    search: `${search}&prefilled_promo_code=XWEEK&client_reference_id=spoof`,
    sessionUrl,
  })
  const sessionQuery = new URL(sessionHref).searchParams
  assert.equal(sessionHref.startsWith(sessionUrl), true)
  assert.equal(sessionQuery.get('utm_source'), 'x')
  assert.equal(sessionQuery.get('ref'), 'ad')
  assert.equal(sessionQuery.get('prefilled_promo_code'), null)
  assert.equal(sessionQuery.get('client_reference_id'), null)

  const sessionId = 'cs_live_order123'
  assert.equal(trackPurchaseOnce({
    sessionId,
    value: 4.99,
    currency: 'usd',
    plan: 'weekly',
  }), true)
  assert.equal(events.length, 1)
  assert.deepEqual(events[0].slice(0, 2), ['event', 'tw-pul9k-pul9m'])
  assert.equal(events[0][2].value, 4.99)
  assert.equal(events[0][2].currency, 'USD')
  assert.equal(events[0][2].conversion_id, sessionId)
  const payload = JSON.stringify(events[0][2])
  assert.equal(payload.includes('@'), false)
  assert.equal(payload.includes('buyer'), false)
  assert.equal(trackPurchaseOnce({ sessionId, value: 4.99, currency: 'USD', plan: 'weekly' }), false)
  assert.equal(events.length, 1)

  sessionMemory.clear()
  assert.equal(trackPurchaseOnce({ sessionId, value: 4.99, currency: 'USD' }), false)

  assert.equal(trackPurchaseOnce({
    sessionId: 'cs_test_novalue123',
    currency: 'USD',
    eventId: 'tw-pul9k-pul9m',
  }), true)
  assert.equal(events.at(-1)[2].conversion_id, 'cs_test_novalue123')
  assert.equal(events.length, 2)
  assert.equal('value' in events.at(-1)[2], false)
  assert.equal(trackPurchaseOnce({ sessionId: 'cs_live_emptyevent', eventId: '' }), false)
})

test('index.html keeps a single pixel slot where the old hardcoded base code was', () => {
  const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8')
  assert.equal(html.split('<!--x-pixel-->').length - 1, 1)
  assert.equal(html.includes('twq('), false)
  assert.equal(html.includes('static.ads-twitter.com'), false)
  const built = applyXPixelHtml(html, {})
  assert.equal(built.split("twq('config'").length - 1, 1)
  assert.match(built, /"pul9k"/)
  assert.equal(applyXPixelHtml(built, { VITE_X_PIXEL_ID: 'other' }), built)
})

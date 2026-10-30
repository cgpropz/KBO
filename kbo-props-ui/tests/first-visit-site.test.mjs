import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import { WEEKLY_LEAD, TIERS } from '../src/pricingTiers.js'
import { autoRenewalStatement } from '../src/autoRenewal.js'
import { renderPricingPage } from '../scripts/publicPages.mjs'

const landing = readFileSync(new URL('../src/PublicLanding.jsx', import.meta.url), 'utf8')
const pricingPage = readFileSync(new URL('../src/SubscriptionPage.jsx', import.meta.url), 'utf8')
const aboutHits = ['/about', 'About CGPropz', '>About<']

test('first-visit nav sends Results to the ledger page and Free top 3 to its section', () => {
  assert.equal(landing.includes('scrollTo(\'free-top-3\'); }}>Free top 3</a>'), true)
  assert.match(landing, /href="\/results">Results</)
  assert.equal(landing.includes('<Results'), false)
  assert.match(landing, /INDEPENDENCE_LINE/)
  for (const phrase of aboutHits) assert.equal(landing.includes(phrase), false, phrase)
})

test('board headers and lane marks explain themselves on tap', () => {
  assert.match(landing, /GlossaryTip label="Line"/)
  assert.match(landing, /GlossaryTip label="Proj"/)
  assert.match(landing, /GlossaryTip label="L10"/)
  assert.match(landing, /GlossaryTip label="CG"/)
  assert.match(landing, /GlossaryTip compact align="start" label="Today's tip"/)
  assert.match(landing, /GlossaryTip compact align="start" label="Unproven"/)
  assert.match(landing, /It is not a probability that the prop hits/)
})

test('weekly first-week price is the lead on every pricing surface, and renewal stays $9.99', () => {
  const weekly = TIERS.find((tier) => tier.id === 'weekly')
  assert.equal(weekly.price, '$9.99')
  assert.equal(weekly.leadPrice, WEEKLY_LEAD.price)
  assert.equal(WEEKLY_LEAD.price, '$4.99')
  assert.match(landing, /WEEKLY_LEAD\.price/)
  assert.match(pricingPage, /tier\.leadPrice \|\| tier\.price/)
  const html = renderPricingPage().html
  assert.match(html, /<p class="price">\$4\.99 <span>first week<\/span><\/p>/)
  assert.match(html, /First week <b>\$4\.99<\/b> with code XWEEK, then \$9\.99\/wk, cancel anytime\./)
  assert.match(autoRenewalStatement(), /Weekly All-Access renews automatically at \$9\.99 every week/)
  assert.match(html, /renews automatically at \$9\.99 every week/)
  const committed = readFileSync(new URL('../public/pricing.html', import.meta.url), 'utf8')
  assert.match(committed, /<p class="price">\$4\.99 <span>first week<\/span><\/p>/)
})

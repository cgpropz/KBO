import assert from 'node:assert/strict'
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { test } from 'node:test'
import { fileURLToPath } from 'node:url'
import sharp from 'sharp'
import { renderKboPage } from '../scripts/kboSeoPage.mjs'
import { renderPricingPage, renderSportPages } from '../scripts/publicPages.mjs'

const uiRoot = fileURLToPath(new URL('..', import.meta.url))

function unescape(value) {
  return value.replace(/&quot;/g, '"').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&#39;/g, "'").replace(/&amp;/g, '&')
}

function head(html) {
  const pick = (re) => {
    const match = html.match(re)
    return match ? unescape(match[1]) : null
  }
  return {
    title: pick(/<title>([^<]*)<\/title>/),
    description: pick(/<meta name="description" content="([^"]*)"/),
    canonical: pick(/<link rel="canonical" href="([^"]*)"/),
    ogTitle: pick(/<meta property="og:title" content="([^"]*)"/),
    ogDescription: pick(/<meta property="og:description" content="([^"]*)"/),
    ogImage: pick(/<meta property="og:image" content="([^"]*)"/),
    twitterTitle: pick(/<meta name="twitter:title" content="([^"]*)"/),
    twitterDescription: pick(/<meta name="twitter:description" content="([^"]*)"/),
    twitterImage: pick(/<meta name="twitter:image" content="([^"]*)"/),
  }
}

function pages() {
  const sport = Object.fromEntries(renderSportPages().map((page) => [page.path, page.html]))
  return {
    '/': readFileSync(join(uiRoot, 'index.html'), 'utf8'),
    '/kbo-player-props': renderKboPage(),
    '/pricing': renderPricingPage().html,
    ...sport,
  }
}

// From /workspace/seo/drafts/meta-rewrite-2026-10-19.md (Code Green OK, Oct 19).
const EXPECTED = {
  '/': 'CGPropz: Player Props Today for NBA, NFL, NHL, WNBA & KBO',
  '/nba-player-props': 'NBA Player Props Today: CG Score & L10 Hit Rates | CGPropz',
  '/nfl-player-props': 'NFL Player Props Today: CG Score & Hit Rates | CGPropz',
  '/nhl-player-props': 'NHL Player Props Today: Free Top 3 & CG Score | CGPropz',
  '/wnba-player-props': 'WNBA Player Props Today: Free Top 3 & CG Score | CGPropz',
  '/kbo-player-props': 'KBO Playoffs Player Props & PrizePicks Picks | CGPropz',
  '/pricing': 'All-Access Pricing: Plans for Every Board | CGPropz',
}

test('rewritten titles fit 60 chars, metas 140-155, and og/twitter match them', () => {
  const all = pages()
  for (const [path, title] of Object.entries(EXPECTED)) {
    const tags = head(all[path])
    assert.equal(tags.title, title, path)
    assert.ok(tags.title.length <= 60, `${path} title ${tags.title.length}`)
    assert.ok(tags.description.length >= 140 && tags.description.length <= 155, `${path} meta ${tags.description.length}`)
    assert.equal(tags.ogTitle, tags.title, path)
    assert.equal(tags.twitterTitle, tags.title, path)
    assert.equal(tags.ogDescription, tags.description, path)
    assert.equal(tags.twitterDescription, tags.description, path)
    const expectedCanonical = path === '/' ? 'https://www.cgpropz.com/' : `https://www.cgpropz.com${path}`
    assert.equal(tags.canonical, expectedCanonical, path)
  }
})

test('"No prop rows" copy is gone from head tags, body FAQ and FAQ JSON-LD', () => {
  for (const [path, html] of Object.entries(pages())) {
    assert.doesNotMatch(html, /prop rows/i, path)
  }
})

test('stale dated copy is gone from public pages', () => {
  const all = pages()
  assert.doesNotMatch(all['/kbo-player-props'], /postseason starts Wednesday, Oct 14/)
  assert.doesNotMatch(all['/nba-player-props'], /opens (Tuesday, |Tue )?Oct 20/)
  assert.doesNotMatch(all['/pricing'], /through Oct 18/)
  for (const guide of ['cg-score', 'start-here']) {
    const md = readFileSync(join(uiRoot, 'content', 'guides', `${guide}.md`), 'utf8')
    assert.doesNotMatch(md, /opens (Tuesday, |Tue )?Oct 20/, guide)
  }
})

test('each sport page has its own 1200x630 share image', async () => {
  const all = pages()
  const seen = new Set()
  for (const path of ['/kbo-player-props', '/nba-player-props', '/nfl-player-props', '/nhl-player-props', '/wnba-player-props']) {
    const tags = head(all[path])
    assert.ok(tags.ogImage.startsWith('https://www.cgpropz.com/images/'), path)
    assert.equal(tags.twitterImage, tags.ogImage, path)
    assert.ok(!seen.has(tags.ogImage), `${path} reuses ${tags.ogImage}`)
    seen.add(tags.ogImage)
    const file = join(uiRoot, 'public', new URL(tags.ogImage).pathname)
    assert.ok(existsSync(file), file)
    const meta = await sharp(file).metadata()
    assert.equal(meta.width, 1200, file)
    assert.equal(meta.height, 630, file)
  }
})

test('NBA is in the homepage nav, hero, pricing board text, and All-Access feature line', () => {
  const landing = readFileSync(join(uiRoot, 'src', 'PublicLanding.jsx'), 'utf8')
  assert.match(landing, /<a href="\/nba-player-props">NBA<\/a>/)
  assert.match(landing, /KBO · NBA · NFL · NHL · WNBA/)
  const home = readFileSync(join(uiRoot, 'index.html'), 'utf8')
  assert.match(home, /href="https:\/\/www\.cgpropz\.com\/nba-player-props">NBA player props<\/a>/)
  const pricing = renderPricingPage().html
  assert.match(pricing, /All-Access covers the KBO, NFL, WNBA, NBA and NHL boards under one login\./)
  assert.match(pricing, /unlocks KBO, WNBA, NFL, NBA, and NHL under one login/)
  const tiers = readFileSync(join(uiRoot, 'src', 'pricingTiers.js'), 'utf8')
  assert.match(tiers, /Full KBO, WNBA, NFL, NHL & NBA projections/)
  assert.equal(/Full KBO, WNBA, NFL & NHL projections/.test(tiers), false)
  assert.match(tiers, /Full KBO, WNBA, NFL, NHL \+ NBA projections/)
  assert.equal(/Full KBO, WNBA, NFL \+ NHL projections/.test(tiers), false)
  assert.match(tiers, /Every board for a year, including NHL and NBA/)
  assert.match(tiers, /KBO, WNBA, NFL, NHL, and NBA/)
  assert.equal(/Every board for a year, including NHL'/.test(tiers), false)
  assert.equal(/KBO, WNBA, NFL, and NHL'/.test(tiers), false)
  assert.match(pricing, /Full KBO, WNBA, NFL, NHL &amp; NBA projections/)
  assert.match(pricing, /Every board for a year, including NHL and NBA/)
  assert.match(pricing, /KBO, WNBA, NFL, NHL, and NBA/)
  const committed = readFileSync(join(uiRoot, 'public', 'pricing.html'), 'utf8')
  assert.match(committed, /Full KBO, WNBA, NFL, NHL &amp; NBA projections/)
  assert.equal(/Full KBO, WNBA, NFL &amp; NHL projections/.test(committed), false)
  assert.match(committed, /Every board for a year, including NHL and NBA/)
  assert.match(committed, /<li>KBO, WNBA, NFL, NHL, and NBA<\/li>/)
  assert.equal(/Every board for a year, including NHL</.test(committed), false)
  assert.equal(/<li>KBO, WNBA, NFL, and NHL<\/li>/.test(committed), false)
  assert.match(landing, /<li>KBO, WNBA, NFL, NBA, and NHL boards<\/li>/)
  assert.equal(/<li>KBO, WNBA, NFL, and NHL boards<\/li>/.test(landing), false)
  const subscription = readFileSync(join(uiRoot, 'src', 'SubscriptionPage.jsx'), 'utf8')
  assert.match(subscription, /Every All-Access plan unlocks <strong>KBO, WNBA, NFL, NBA, and NHL<\/strong>/)
  assert.match(subscription, /<span className="sub-combine-icon">⚾🏀🏈🏒<\/span>/)
  assert.match(subscription, /unlocks KBO, WNBA, NFL, NBA, and NHL under one login/)
  assert.match(subscription, /It does not unlock the KBO, WNBA, NFL, or NHL boards on the site\. Discord Only doesn't include the site boards, NBA included\./)
  assert.match(subscription, /All features are unlocked across ⚾ KBO, 🏀 WNBA, 🏈 NFL, 🏀 NBA, and 🏒 NHL/)
  assert.equal(/KBO, WNBA, NFL, and NHL/.test(subscription), false)
  const success = readFileSync(join(uiRoot, 'src', 'CheckoutSuccess.jsx'), 'utf8')
  assert.match(success, /KBO, WNBA, NFL, NBA, and NHL boards, projections and tools/)
  assert.equal(/KBO, WNBA, NFL, and NHL boards/.test(success), false)
  const entitlements = readFileSync(join(uiRoot, 'src', 'entitlements.js'), 'utf8')
  assert.match(entitlements, /including NHL and NBA/)
  assert.equal(/including NHL\./.test(entitlements), false)
  const freePreview = readFileSync(join(uiRoot, 'src', 'freePreviewCopy.js'), 'utf8')
  assert.match(freePreview, /Top 3 projections — KBO, WNBA, NFL & NHL/)
  const publicFaqs = readFileSync(join(uiRoot, 'src', 'publicFaqs.js'), 'utf8')
  assert.match(publicFaqs, /KBO, WNBA, NFL, and NHL boards refresh/)
  assert.equal(/KBO, WNBA, NFL, NBA, and NHL boards refresh/.test(publicFaqs), false)
  assert.match(committed, /Top 3 projections — KBO, WNBA, NFL &amp; NHL/)
  assert.match(committed, /preview of the top 3 lines on the KBO, WNBA, NFL, and NHL boards/)
})

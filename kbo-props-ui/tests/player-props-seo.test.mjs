import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'
import { fileURLToPath } from 'node:url'
import { appBoardPath } from '../src/appSport.js'
import { buildResultDays, discoverSummaryFiles, renderKboPage, sitemapEntries } from '../scripts/kboSeoPage.mjs'
import { renderNbaPlayerPropsPage } from '../scripts/publicPages.mjs'
import { organizationNode } from '../scripts/seoShared.mjs'

const memoryRoot = fileURLToPath(new URL('../../memory/kbo', import.meta.url))

function graph(html) {
  const match = html.match(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/)
  assert.ok(match, 'JSON-LD script')
  return JSON.parse(match[1])
}

function decode(value) {
  return value
    .replace(/<[^>]+>/g, '')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#42;/g, '*')
    .replace(/\s+/g, ' ')
    .trim()
}

function visibleFaqs(html) {
  const section = html.split('<h2>FAQ</h2>')[1]?.split('<h2>')[0]
  assert.ok(section, 'visible FAQ')
  return [...section.matchAll(/<h3>([\s\S]*?)<\/h3>\s*<p>([\s\S]*?)<\/p>/g)].map((match) => ({
    q: decode(match[1]),
    a: decode(match[2]),
  }))
}

function assertFaqMatches(html) {
  const data = graph(html)
  assert.equal(data['@context'], 'https://schema.org')
  assert.deepEqual(data['@graph'][0], organizationNode())
  assert.equal(data['@graph'][1]['@type'], 'BreadcrumbList')
  const faq = data['@graph'].find((node) => node['@type'] === 'FAQPage')
  assert.ok(faq)
  const visible = visibleFaqs(html)
  assert.deepEqual(
    visible.map((item) => item.q),
    faq.mainEntity.map((item) => item.name),
  )
  assert.deepEqual(
    visible.map((item) => item.a),
    faq.mainEntity.map((item) => item.acceptedAnswer.text),
  )
  assert.equal(html.includes('{{'), false)
  assert.equal(html.includes('<!--'), false)
  assert.equal(/goal scorer/i.test(html), false)
}

test('NBA player props page uses the app board, hides the unconfirmed slate, and matches its FAQ', () => {
  assert.equal(appBoardPath('nba'), '/?sport=nba')
  const page = renderNbaPlayerPropsPage()
  const { html } = page
  assert.equal(page.title, 'NBA Player Props Today & PrizePicks Picks | CGPropz')
  assert.match(html, /<h1>NBA player props, with the full board\.<\/h1>/)
  assert.match(html, /There is no free NBA preview/)
  assert.match(html, /<strong>The NBA board opens Tuesday, Oct 20<\/strong>/)
  assert.match(html, /<strong>L10<\/strong> as the main view/)
  assert.match(html, /<p><strong><a href="https:\/\/www\.cgpropz\.com\/\?sport=nba">Open the NBA board<\/a><\/strong> \(opens Oct 20\)/)
  assert.match(html, /href="https:\/\/www\.cgpropz\.com\/\?sport=nba">Open the NBA board<\/a>/)
  assert.match(html, /href="https:\/\/www\.cgpropz\.com\/pricing">See All-Access pricing<\/a>/)
  assert.match(html, /Boston Celtics at Detroit Pistons/)
  assert.match(html, /New York at Boston/)
  assert.match(html, /how far the projection sits from the line/)
  assert.equal(html.includes('Higher score = bigger model edge'), false)
  assert.equal(/times 50/i.test(html), false)
  assert.equal(html.includes('minimum-line'), false)
  assert.equal(html.includes('Oct 24'), false)
  assert.equal(html.includes('Oct 25'), false)
  assert.equal(html.includes('Oct 26'), false)
  assert.equal(html.includes('coming soon'), false)
  assert.equal(count(html, '<h1'), 1)
  const data = graph(html)
  assert.equal(data['@graph'][1].itemListElement[1].name, 'NBA player props')
  assert.equal(data['@graph'][1].itemListElement[1].item, 'https://www.cgpropz.com/nba-player-props')
  assertFaqMatches(html)
  assert.equal(data['@graph'].find((node) => node['@type'] === 'FAQPage').mainEntity.length, 5)
  const locs = sitemapEntries().map((entry) => entry.loc)
  assert.ok(locs.includes('https://www.cgpropz.com/nba-player-props'))
})

test('KBO page keeps the playoff guide and leaves the results table off', () => {
  const days = buildResultDays(discoverSummaryFiles(memoryRoot))
  assert.ok(days.some((day) => day.missing === false))
  const html = renderKboPage(days)
  assert.match(html, /<title>KBO Playoffs Player Props &amp; PrizePicks Picks \| CGPropz<\/title>/)
  assert.match(html, /<h1>KBO player props, with the full board\.<\/h1>/)
  assert.match(html, /href="https:\/\/www\.cgpropz\.com\/\?sport=kbo">KBO board<\/a>/)
  assert.match(html, /href="https:\/\/www\.cgpropz\.com\/\?sport=kbo">Open the KBO board<\/a>/)
  assert.match(html, /href="https:\/\/www\.cgpropz\.com\/pricing">pricing<\/a>/)
  assert.match(html, /href="https:\/\/www\.cgpropz\.com\/pricing">See pricing<\/a>/)
  assert.match(html, /href="https:\/\/www\.cgpropz\.com\/#free-top-3"/)
  assert.match(html, /<h2>KBO postseason 2026: schedule and first pitch in ET<\/h2>/)
  assert.match(html, /5:30 AM/)
  assert.match(html, /1:00 AM/)
  assert.match(html, /4:30 AM/)
  assert.match(html, /From Sat Oct 17: Oct 17, 18, 20, 21&#42;, 23&#42;/)
  assert.match(html, /Weekdays 4:30 AM; Sat Nov 7: 12:00 AM \(midnight Fri night ET\)/)
  assert.equal(html.includes('one source says'), false)
  assert.equal(html.includes('Game 7'), false)
  assert.equal(html.includes('Recent full-board results'), false)
  assert.equal(html.includes('Date (KST)'), false)
  assert.equal(html.includes('Kim Ji-chan'), false)
  assert.equal(html.includes('full-board graded results'), false)
  assert.equal(html.includes('not verified'), false)
  assert.equal(html.includes('public write-up'), false)
  assert.equal(/\bverified\b/i.test(html), false)
  assert.equal(count(html, '<h1'), 1)
  const data = graph(html)
  assert.equal(data['@graph'][1].itemListElement[1].name, 'KBO player props')
  assert.equal(data['@graph'][1].itemListElement[1].item, 'https://www.cgpropz.com/kbo-player-props')
  assert.equal(data['@graph'].some((node) => node['@type'] === 'Article'), false)
  assert.equal(JSON.stringify(data).includes('full-board result'), false)
  assertFaqMatches(html)
  assert.equal(visibleFaqs(html).length, 6)
  const source = readFileSync(fileURLToPath(new URL('../content/kbo-player-props.md', import.meta.url)), 'utf8')
  assert.equal(source.includes('{{QA: not verified in ledger}}'), false)
  assert.equal(html.includes('{{'), false)
})

function count(html, token) {
  return html.split(token).length - 1
}

import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { fileURLToPath } from 'node:url'
import {
  buildResultDays,
  calendarDays,
  discoverSummaryFiles,
  renderKboPage,
  renderSitemap,
} from '../scripts/kboSeoPage.mjs'
import { writeKboSeo } from '../scripts/build-kbo-seo.mjs'

const uiRoot = fileURLToPath(new URL('..', import.meta.url))

function summary(overrides) {
  return {
    hits: 1,
    misses: 2,
    pushes: 3,
    dnps: 4,
    voids: 0,
    props_graded: 10,
    props_hit: [{ player: 'A', team: 'LG', stat: 'Hits', side: 'OVER', line: 0.5, actual: 1, model_result: 'HIT' }],
    props_miss: [{ player: 'B', team: 'Kia', stat: 'Strikeouts', side: 'UNDER', line: 4.5, actual: 6, model_result: 'MISS' }],
    ...overrides,
  }
}

function writeDay(root, iso, data) {
  const [year, month, day] = iso.split('-')
  const dir = join(root, month, day, year)
  mkdirSync(dir, { recursive: true })
  if (data) writeFileSync(join(dir, 'summary.json'), JSON.stringify(data))
}

test('the calendar keeps every day, including ones with no summary', () => {
  assert.deepEqual(calendarDays('2026-10-01', '2026-10-03'), ['2026-10-01', '2026-10-02', '2026-10-03'])
  const root = mkdtempSync(join(tmpdir(), 'kbo-seo-'))
  writeDay(root, '2026-10-01', summary({}))
  writeDay(root, '2026-10-03', summary({ hits: 0, misses: 1, pushes: 1, dnps: 1 }))
  mkdirSync(join(root, '10', '02', '2026'), { recursive: true })
  const days = buildResultDays(discoverSummaryFiles(root))
  assert.deepEqual(days.map((day) => day.iso), ['2026-10-01', '2026-10-02', '2026-10-03'])
  assert.equal(days[1].missing, true)
  assert.equal(days[0].hits, 1)
  assert.equal(days[0].pushes, 3)
  assert.equal(days[0].dnps, 4)
  assert.equal(days[0].rows.length, 2)

  const html = renderKboPage(days)
  assert.equal(html.includes('full-board results'), false)
  assert.equal(html.includes('No full-board results for this date'), false)
  assert.equal(html.includes('<th>Date (KST)</th>'), false)
  assert.equal(html.includes('Sep 24, 2026'), false)
  assert.match(html, /1-800-GAMBLER/)
  assert.match(html, /21\+ only/)
  assert.match(html, /not affiliated with PrizePicks or Underdog/)
  assert.match(html, /href="https:\/\/www\.cgpropz\.com\/pricing"/)
  assert.match(html, /href="https:\/\/www\.cgpropz\.com\/kbo-player-props"/)
  assert.match(html, /How the KBO board works/)
  assert.match(html, /<h2>KBO postseason 2026: schedule and first pitch in ET<\/h2>/)
  assert.equal(html.includes('{{'), false)
  assert.equal(/\bverified\b/i.test(html), false)
  assert.match(html, /canonical" href="https:\/\/www\.cgpropz\.com\/kbo-player-props"/)
  assert.match(html, /property="og:title"/)
})

test('sitemap lists the home page and the KBO page', () => {
  const xml = renderSitemap()
  assert.match(xml, /<loc>https:\/\/www\.cgpropz\.com\/<\/loc>/)
  assert.match(xml, /<loc>https:\/\/www\.cgpropz\.com\/kbo-player-props<\/loc>/)
  assert.match(xml, /<lastmod>\d{4}-\d{2}-\d{2}<\/lastmod>/)
})

test('known SEO pages are explicit rewrites and unknown paths are not sent to the SPA', () => {
  const config = JSON.parse(readFileSync(join(uiRoot, 'vercel.json'), 'utf8'))
  const seo = config.rewrites.findIndex((rule) => rule.source === '/kbo-player-props')
  assert.ok(seo >= 0)
  assert.equal(config.rewrites[seo].destination, '/kbo-player-props.html')
  assert.equal(config.rewrites.some((rule) => rule.source === '/((?!api/|data/).*)'), false)
  assert.equal(config.rewrites.some((rule) => rule.destination === '/index.html'), false)
  assert.equal(config.cleanUrls, true)
  const robots = readFileSync(join(uiRoot, 'public/robots.txt'), 'utf8')
  assert.match(robots, /Sitemap: https:\/\/www\.cgpropz\.com\/sitemap\.xml/)
})

test('a build writes the KBO page without the results table', () => {
  const dir = mkdtempSync(join(tmpdir(), 'kbo-seo-out-'))
  const html = join(dir, 'page.html')
  const sitemap = join(dir, 'sitemap.xml')
  writeFileSync(html, '<p>Recent full-board results</p>')
  const wrote = writeKboSeo({ htmlPath: html, sitemapPath: sitemap })
  assert.equal(wrote.wroteHtml, true)
  const page = readFileSync(html, 'utf8')
  assert.equal(page.includes('Recent full-board results'), false)
  assert.match(page, /How the KBO board works/)
  const xml = readFileSync(sitemap, 'utf8')
  assert.match(xml, /kbo-player-props/)
  assert.equal(xml.includes('full-board'), false)
})

import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { test } from 'node:test'
import { fileURLToPath } from 'node:url'
import { writeSeoSite } from '../scripts/build-kbo-seo.mjs'
import { listGuides } from '../scripts/markdownGuide.mjs'
import { resolveRequest } from '../scripts/staticRouter.mjs'
import { startStaticServer } from '../scripts/staticRouter.mjs'

const uiRoot = fileURLToPath(new URL('..', import.meta.url))
const config = JSON.parse(readFileSync(join(uiRoot, 'vercel.json'), 'utf8'))

const PUBLIC_PAGES = [
  ['/', 'CGPropz: Free PrizePicks prop picks daily', 'One edge. Every sport.'],
  ['/pricing', 'All-Access pricing | CGPropz', 'All-Access pricing'],
  ['/kbo-player-props', 'KBO player props and full-board results | CGPropz', 'KBO player props, with the full board.'],
  ['/nfl-player-props', 'NFL player props | CGPropz', 'NFL player props'],
  ['/wnba-player-props', 'WNBA player props | CGPropz', 'WNBA player props'],
  ['/nba-player-props', 'NBA player props | CGPropz', 'NBA player props'],
  ['/nhl-player-props', 'NHL player props | CGPropz', 'NHL player props'],
  ['/guides/cg-score', 'How CG Score Works: Projection vs Line | CGPropz', 'How CG Score Works'],
]

test('unknown paths 404 and paid static URLs are not rewritten to the homepage', () => {
  const files = new Set([
    '/index.html',
    '/pricing.html',
    '/404.html',
    '/data/team_opponent_stats_2026.json',
  ])
  const unknown = resolveRequest('/this-page-does-not-exist', { files, config })
  assert.equal(unknown.status, 404)
  assert.equal(unknown.file, '/404.html')
  const paid = resolveRequest('/data/prizepicks_props.json', { files, config })
  assert.equal(paid.status, 404)
  assert.notEqual(paid.file, '/index.html')
  const stats = resolveRequest('/data/team_opponent_stats_2026.json', { files, config })
  assert.equal(stats.status, 200)
  assert.equal(stats.file, '/data/team_opponent_stats_2026.json')
  assert.equal(resolveRequest('/nfl', { files, config }).status, 301)
  assert.equal(resolveRequest('/nfl', { files, config }).location, '/nfl-player-props')
})

test('http status, title, and h1 for known pages; 404 for unknown', async () => {
  writeSeoSite()
  const server = await startStaticServer(uiRoot, config)
  try {
    const seenTitles = new Set()
    for (const [path, title, h1] of PUBLIC_PAGES) {
      const response = await fetch(server.url + path, { redirect: 'manual' })
      assert.equal(response.status, 200, path)
      const html = await response.text()
      assert.match(html, new RegExp(`<title>${escapeRegExp(title)}</title>`), path)
      assert.match(html, new RegExp(`<h1>${escapeRegExp(h1)}</h1>`), path)
      assert.equal(count(html, '<h1'), 1, path)
      assert.match(html, /21\+ only\. Gambling problem\? Call 1-800-GAMBLER\./, path)
      assert.match(html, /CGPropz is not affiliated with PrizePicks or Underdog\. For entertainment only\./, path)
      assert.match(html, /"@type":"Organization"/, path)
      seenTitles.add(title)
    }
    assert.equal(seenTitles.size, PUBLIC_PAGES.length)

    const missing = await fetch(`${server.url}/not-a-real-cgpropz-page`, { redirect: 'manual' })
    assert.equal(missing.status, 404)
    const missingHtml = await missing.text()
    assert.match(missingHtml, /<h1>Page not found<\/h1>/)
    assert.match(missingHtml, /noindex/)
    assert.doesNotMatch(missingHtml, /<h1>One edge/)

    for (const [source, destination] of [
      ['/nfl', '/nfl-player-props'],
      ['/wnba', '/wnba-player-props'],
      ['/nba', '/nba-player-props'],
      ['/nhl', '/nhl-player-props'],
      ['/kbo', '/kbo-player-props'],
      ['/plans', '/pricing'],
      ['/board', '/kbo-player-props'],
      ['/app', '/'],
    ]) {
      const response = await fetch(server.url + source, { redirect: 'manual' })
      assert.equal(response.status, 301, source)
      assert.equal(response.headers.get('location'), destination, source)
    }

    const home = await (await fetch(server.url + '/')).text()
    assert.equal(home.includes('Loading KBO Player Props'), false)
    for (const path of ['/pricing', '/kbo-player-props', '/nfl-player-props', '/wnba-player-props', '/nba-player-props', '/nhl-player-props', '/guides/cg-score']) {
      assert.match(home, new RegExp(`href="https://www\\.cgpropz\\.com${path}"`))
    }

    const guide = await (await fetch(`${server.url}/guides/cg-score`)).text()
    assert.match(guide, /"@type":"Article"/)
    assert.match(guide, /"@type":"BreadcrumbList"/)
    assert.match(guide, /"@type":"FAQPage"/)
    assert.match(guide, /<h2>FAQ<\/h2>/)
    assert.match(guide, /<h3>What is CG Score\?<\/h3>/)
    assert.match(guide, /projection ÷ line/)
    assert.match(guide, /\{\{CONFIRM WITH BOARD QA\}\}/)
    assert.equal(guide.includes('URL PENDING'), false)
    assert.equal(guide.includes('GRAPHIC DESIGNER'), false)
    assert.equal(guide.includes('53.6'), false)
    assert.equal(/weakly predictive/i.test(guide), false)
    assert.match(guide, /href="https:\/\/www\.cgpropz\.com\/pricing"/)
    assert.match(guide, /href="https:\/\/www\.cgpropz\.com\/nfl-player-props"/)

    const nfl = await (await fetch(`${server.url}/nfl-player-props`)).text()
    assert.match(nfl, /"@type":"FAQPage"/)
    assert.match(nfl, /"@type":"BreadcrumbList"/)
    assert.equal(nfl.includes('"@type":"Article"'), false)
    assert.equal(nfl.includes('/api/data'), false)
    assert.match(nfl, /does not include paid board rows/)

    const sitemap = await (await fetch(`${server.url}/sitemap.xml`)).text()
    for (const [path] of PUBLIC_PAGES) {
      const loc = path === '/' ? 'https://www.cgpropz.com/' : `https://www.cgpropz.com${path}`
      assert.match(sitemap, new RegExp(`<loc>${escapeRegExp(loc)}</loc>\\s*<lastmod>\\d{4}-\\d{2}-\\d{2}</lastmod>`))
    }
    assert.equal(sitemap.includes('/not-a-real'), false)
    assert.equal(sitemap.includes('404.html'), false)
    for (const guide of listGuides()) {
      assert.match(sitemap, new RegExp(`<loc>https://www\\.cgpropz\\.com${escapeRegExp(guide.path)}</loc>`))
    }

    const robots = await (await fetch(`${server.url}/robots.txt`)).text()
    assert.match(robots, /Sitemap: https:\/\/www\.cgpropz\.com\/sitemap\.xml/)
    assert.match(robots, /Disallow: \/api\//)
  } finally {
    await server.close()
  }

  execFileSync('npx', ['vite', 'build'], { cwd: uiRoot, stdio: 'pipe' })
  const builtHome = readFileSync(join(uiRoot, 'dist/index.html'), 'utf8')
  assert.match(builtHome, /<title>CGPropz: Free PrizePicks prop picks daily<\/title>/)
  assert.match(builtHome, /<h1>One edge\. Every sport\.<\/h1>/)
  assert.equal(builtHome.includes('Loading KBO Player Props'), false)
  const builtPricing = readFileSync(join(uiRoot, 'dist/pricing.html'), 'utf8')
  assert.match(builtPricing, /<title>All-Access pricing \| CGPropz<\/title>/)
  assert.match(builtPricing, /<h1>All-Access pricing<\/h1>/)
  const builtGuide = readFileSync(join(uiRoot, 'dist/guides/cg-score.html'), 'utf8')
  assert.match(builtGuide, /<h1>How CG Score Works<\/h1>/)
  const builtMissing = readFileSync(join(uiRoot, 'dist/404.html'), 'utf8')
  assert.match(builtMissing, /<h1>Page not found<\/h1>/)
  assert.equal(existsSync(join(uiRoot, 'dist/data/prizepicks_props.json')), false)
})

function count(html, token) {
  return html.split(token).length - 1
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

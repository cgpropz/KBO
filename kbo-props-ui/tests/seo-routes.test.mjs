import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { test } from 'node:test'
import { fileURLToPath } from 'node:url'
import { writeSeoSite } from '../scripts/build-kbo-seo.mjs'
import { canonicalGuidePath, listGuides, stripGuideSource } from '../scripts/markdownGuide.mjs'
import { resolveRequest } from '../scripts/staticRouter.mjs'
import { startStaticServer } from '../scripts/staticRouter.mjs'

const uiRoot = fileURLToPath(new URL('..', import.meta.url))
const config = JSON.parse(readFileSync(join(uiRoot, 'vercel.json'), 'utf8'))

const PUBLIC_PAGES = [
  ['/', 'CGPropz: Every prop line, scored.', 'Every prop line, scored.'],
  ['/pricing', 'All-Access pricing | CGPropz', 'All-Access pricing'],
  ['/policies', 'Plans &amp; Policies | CGPropz', 'Plans &amp; Policies'],
  ['/terms', 'Terms | CGPropz', 'Terms'],
  ['/privacy', 'Privacy | CGPropz', 'Privacy'],
  ['/responsible-gaming', 'Responsible gaming | CGPropz', 'Responsible gaming'],
  ['/states-not-available', 'Where CGPropz isn\'t available | CGPropz', 'Where CGPropz is not available'],
  ['/kbo-player-props', 'KBO Playoffs Player Props &amp; PrizePicks Picks | CGPropz', 'KBO player props, with the full board.'],
  ['/nfl-player-props', 'NFL player props | CGPropz', 'NFL player props'],
  ['/wnba-player-props', 'WNBA player props | CGPropz', 'WNBA player props'],
  ['/nba-player-props', 'NBA Player Props Today &amp; PrizePicks Picks | CGPropz', 'NBA player props, with the full board.'],
  ['/nhl-player-props', 'NHL player props | CGPropz', 'NHL player props'],
  ['/guides/cg-score', 'How CG Score Works: Projection vs Line | CGPropz', 'How CG Score Works'],
  ['/guides/start-here', 'Start Here: How to Read Player Props | CGPropz', 'Start Here: How to Read Player Props on CGPropz'],
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
      assert.equal(html.includes('{{'), false, path)
      assert.match(html, /21\+ only\. Gambling problem\? Call 1-800-GAMBLER\./, path)
      assert.match(html, /21\+ · Play responsibly · Entertainment only · 1-800-GAMBLER/, path)
      assert.match(html, /CGPropz is not a sportsbook or operator; projections are estimates, not guarantees\./, path)
      if (path === '/') {
        assert.doesNotMatch(html, /PrizePicks/i, path)
      } else {
        assert.match(html, /CGPropz is not affiliated with PrizePicks or Underdog\. For entertainment only\./, path)
      }
      assert.match(html, /https:\/\/www\.ncpgambling\.org/, path)
      assert.match(html, /"@type":"Organization"/, path)
      seenTitles.add(title)
    }
    assert.equal(seenTitles.size, PUBLIC_PAGES.length)

    const missing = await fetch(`${server.url}/not-a-real-cgpropz-page`, { redirect: 'manual' })
    assert.equal(missing.status, 404)
    const missingHtml = await missing.text()
    assert.match(missingHtml, /<h1>Page not found<\/h1>/)
    assert.match(missingHtml, /noindex/)
    assert.doesNotMatch(missingHtml, /<h1>Every prop line/)

    for (const [source, destination] of [
      ['/nfl', '/nfl-player-props'],
      ['/wnba', '/wnba-player-props'],
      ['/nba', '/nba-player-props'],
      ['/nhl', '/nhl-player-props'],
      ['/kbo', '/kbo-player-props'],
      ['/plans', '/pricing'],
      ['/board', '/kbo-player-props'],
      ['/app', '/'],
      ['/start-here', '/guides/start-here'],
      ['/how-cg-score', '/guides/cg-score'],
    ]) {
      const response = await fetch(server.url + source, { redirect: 'manual' })
      assert.equal(response.status, 301, source)
      assert.equal(response.headers.get('location'), destination, source)
    }

    const home = await (await fetch(server.url + '/')).text()
    assert.equal(home.includes('Loading KBO Player Props'), false)
    assert.match(home, /id="free-top-3"/)
    for (const path of ['/pricing', '/policies', '/terms', '/privacy', '/responsible-gaming', '/states-not-available', '/kbo-player-props', '/nfl-player-props', '/wnba-player-props', '/nba-player-props', '/nhl-player-props', '/guides/cg-score']) {
      assert.match(home, new RegExp(`href="https://www\\.cgpropz\\.com${path}"`))
    }

    const guide = await (await fetch(`${server.url}/guides/cg-score`)).text()
    assert.match(guide, /"@type":"Article"/)
    assert.match(guide, /"@type":"BreadcrumbList"/)
    assert.match(guide, /"@type":"FAQPage"/)
    assert.match(guide, /<h2>FAQ<\/h2>/)
    assert.match(guide, /<h3>What is CG Score\?<\/h3>/)
    assert.match(guide, /Higher score = bigger model edge/)
    assert.equal(guide.includes('projection ÷ line'), false)
    assert.equal(guide.includes('× 50'), false)
    assert.equal(guide.includes('{{'), false)
    assert.equal(guide.includes('<td>NBA</td>'), false)
    assert.match(guide, /src="\/images\/how-cg-score-diagram.png"/)
    assert.match(guide, /property="og:image" content="https:\/\/www\.cgpropz\.com\/images\/how-cg-score-works-featured.png"/)
    assert.match(guide, /name="twitter:image" content="https:\/\/www\.cgpropz\.com\/images\/how-cg-score-works-featured.png"/)
    assert.equal(guide.includes('Pass yards'), false)
    assert.equal(guide.includes('URL PENDING'), false)
    assert.equal(guide.includes('GRAPHIC DESIGNER'), false)
    assert.equal(guide.includes('53.6'), false)
    assert.equal(/weakly predictive/i.test(guide), false)
    assert.match(guide, /href="https:\/\/www\.cgpropz\.com\/pricing"/)
    assert.match(guide, /href="https:\/\/www\.cgpropz\.com\/nfl-player-props"/)
    assert.match(guide, /rel="canonical" href="https:\/\/www\.cgpropz\.com\/guides\/cg-score"/)

    const startHere = await (await fetch(`${server.url}/guides/start-here`)).text()
    assert.match(startHere, /rel="canonical" href="https:\/\/www\.cgpropz\.com\/guides\/start-here"/)
    assert.equal(startHere.includes('https://www.cgpropz.com/start-here'), false)
    assert.match(startHere, /"@type":"Article"/)
    assert.match(startHere, /"@type":"BreadcrumbList"/)
    assert.match(startHere, /"@type":"FAQPage"/)
    assert.equal(startHere.includes('{{'), false)
    assert.match(startHere, /src="\/images\/start-here-board-row.png"/)
    assert.match(startHere, /property="og:image" content="https:\/\/www\.cgpropz\.com\/images\/start-here-featured.png"/)
    assert.match(startHere, /Higher score = bigger model edge/)
    assert.equal(startHere.includes('× 50'), false)
    assert.equal(startHere.includes('projection ÷'), false)
    assert.equal(/times 50/i.test(startHere), false)
    assert.equal(startHere.includes('<strong>NBA:</strong>'), false)
    assert.equal(startHere.includes('URL PENDING'), false)
    const startSource = readFileSync(join(uiRoot, 'content/guides/start-here.md'), 'utf8')
    const startMeta = stripGuideSource(startSource).meta
    assert.equal(startMeta.canonical, 'https://www.cgpropz.com/start-here')
    assert.equal(canonicalGuidePath(startMeta, '/guides/start-here'), '/guides/start-here')
    for (const page of listGuides()) {
      assert.match(page.html, new RegExp(`rel="canonical" href="https://www\\.cgpropz\\.com${escapeRegExp(page.path)}"`))
      assert.equal(page.path.startsWith('/guides/'), true)
      assert.equal(page.html.includes('rel="canonical" href="https://www.cgpropz.com/start-here"'), false)
    }
    const broken = await brokenInternalLinks(startHere, server.url, home)
    assert.deepEqual(broken, [])

    const wnba = await (await fetch(`${server.url}/wnba-player-props`)).text()
    assert.equal(count(wnba, '<h1'), 1)
    assert.match(wnba, /<h2>WNBA Finals Player Props: Valkyries vs Dream<\/h2>/)
    assert.match(wnba, /Saturday, Oct 17/)
    assert.match(wnba, /When do the 2026 WNBA Finals start/)
    assert.match(wnba, /Game 1 is Saturday, Oct 17, at 3:30 PM ET at Chase Center/)
    assert.equal(wnba.includes('{{'), false)
    assert.equal(wnba.includes('FROM BOARD QA'), false)
    assert.equal(wnba.includes('wnba-finals-player-props-2026'), false)
    assert.match(wnba, /rel="canonical" href="https:\/\/www\.cgpropz\.com\/wnba-player-props"/)
    assert.match(wnba, /property="og:image" content="https:\/\/www\.cgpropz\.com\/images\/wnba-finals-featured.png"/)
    assert.match(wnba, /name="twitter:image" content="https:\/\/www\.cgpropz\.com\/images\/wnba-finals-featured.png"/)
    assert.match(wnba, /does not include paid board rows/)
    assert.match(wnba, /href="https:\/\/www\.cgpropz\.com\/\?sport=wnba">Open the WNBA board/)

    for (const [path, sport, label] of [
      ['/kbo-player-props', 'kbo', 'KBO'],
      ['/nfl-player-props', 'nfl', 'NFL'],
      ['/nba-player-props', 'nba', 'NBA'],
      ['/nhl-player-props', 'nhl', 'NHL'],
    ]) {
      const page = await (await fetch(`${server.url}${path}`)).text()
      assert.match(page, new RegExp(`href="https://www\\.cgpropz\\.com/\\?sport=${sport}">Open the ${label} board`))
    }

    for (const image of [
      '/images/start-here-featured.png',
      '/images/start-here-board-row.png',
      '/images/how-cg-score-works-featured.png',
      '/images/how-cg-score-diagram.png',
      '/images/wnba-finals-featured.png',
    ]) {
      const response = await fetch(server.url + image)
      assert.equal(response.status, 200, image)
      assert.match(response.headers.get('content-type') || '', /^image\//, image)
    }

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
    assert.equal(/<loc>https:\/\/www\.cgpropz\.com\/start-here<\/loc>/.test(sitemap), false)
    assert.equal(sitemap.includes('/not-a-real'), false)
    assert.equal(sitemap.includes('404.html'), false)
    for (const guide of listGuides()) {
      assert.match(sitemap, new RegExp(`<loc>https://www\\.cgpropz\\.com${escapeRegExp(guide.path)}</loc>`))
    }

    const policies = await (await fetch(`${server.url}/policies`)).text()
    assert.match(policies, /rel="canonical" href="https:\/\/www\.cgpropz\.com\/policies"/)
    assert.match(policies, /Weekly plans: no refunds once a weekly period has started\./)
    assert.match(policies, /Monthly, Yearly and Lifetime: 7-day refund window on the first payment\./)
    assert.match(policies, /All plans: cancel anytime\./)
    assert.match(policies, /Cancel Subscription/)
    assert.match(policies, /Yes, Cancel/)
    assert.match(policies, /If a plan price changes, CGPropz will announce the new price before it applies\./)
    assert.match(policies, /Play responsibly\./)
    assert.match(policies, /https:\/\/discord\.gg\/w3wgbCcxDZ/)
    assert.match(policies, /href="https:\/\/www\.cgpropz\.com\/pricing"/)
    assert.equal(/\$\d/.test(policies), false)
    assert.equal(/grandfather/i.test(policies), false)
    const pricingPage = await (await fetch(`${server.url}/pricing`)).text()
    assert.match(pricingPage, /href="https:\/\/www\.cgpropz\.com\/policies"/)
    assert.match(pricingPage, /Auto-renewal/)
    assert.match(pricingPage, /renews automatically at \$9\.99 every week until you cancel/)
    assert.match(pricingPage, /When the XWEEK code applies, the first week is \$4\.99/)

    const terms = await (await fetch(`${server.url}/terms`)).text()
    assert.match(terms, /\[LEGAL ENTITY NAME\]/)
    assert.match(terms, /\[CONTACT ADDRESS\]/)
    assert.match(terms, /renews automatically at \$29\.99 every month until you cancel/)

    const privacy = await (await fetch(`${server.url}/privacy`)).text()
    assert.match(privacy, /\[LEGAL ENTITY NAME\]/)
    assert.match(privacy, /age confirmation stays in this browser/)

    const responsible = await (await fetch(`${server.url}/responsible-gaming`)).text()
    assert.match(responsible, /1-800-GAMBLER/)
    assert.match(responsible, /href="https:\/\/www\.ncpgambling\.org"/)
    assert.match(responsible, /How to cancel/)

    const states = await (await fetch(`${server.url}/states-not-available`)).text()
    for (const code of ['WA', 'NV', 'ID', 'HI', 'MT', 'CA', 'FL', 'MI', 'NY', 'AZ', 'OH', 'WY', 'AR']) {
      assert.match(states, new RegExp(`\\(${code}\\)`))
    }
    assert.match(states, /Under review/)
    assert.match(states, /does not check your location and does not block/)

    const robots = await (await fetch(`${server.url}/robots.txt`)).text()
    assert.match(robots, /Sitemap: https:\/\/www\.cgpropz\.com\/sitemap\.xml/)
    assert.match(robots, /Disallow: \/api\//)
  } finally {
    await server.close()
  }

  execFileSync('npx', ['vite', 'build'], { cwd: uiRoot, stdio: 'pipe' })
  const builtHome = readFileSync(join(uiRoot, 'dist/index.html'), 'utf8')
  assert.match(builtHome, /<title>CGPropz: Every prop line, scored\.<\/title>/)
  assert.match(builtHome, /<h1>Every prop line, scored\.<\/h1>/)
  assert.doesNotMatch(builtHome, /PrizePicks/i)
  assert.match(builtHome, /id="free-top-3"/)
  assert.equal(builtHome.includes('Loading KBO Player Props'), false)
  const builtPricing = readFileSync(join(uiRoot, 'dist/pricing.html'), 'utf8')
  assert.match(builtPricing, /<title>All-Access pricing \| CGPropz<\/title>/)
  assert.match(builtPricing, /<h1>All-Access pricing<\/h1>/)
  const builtGuide = readFileSync(join(uiRoot, 'dist/guides/cg-score.html'), 'utf8')
  assert.match(builtGuide, /<h1>How CG Score Works<\/h1>/)
  const builtStart = readFileSync(join(uiRoot, 'dist/guides/start-here.html'), 'utf8')
  assert.match(builtStart, /<h1>Start Here: How to Read Player Props on CGPropz<\/h1>/)
  assert.match(builtStart, /rel="canonical" href="https:\/\/www\.cgpropz\.com\/guides\/start-here"/)
  const builtMissing = readFileSync(join(uiRoot, 'dist/404.html'), 'utf8')
  assert.match(builtMissing, /<h1>Page not found<\/h1>/)
  assert.equal(existsSync(join(uiRoot, 'dist/data/prizepicks_props.json')), false)

  for (const file of ['dist/nba-player-props.html', 'dist/kbo-player-props.html']) {
    const built = readFileSync(join(uiRoot, file), 'utf8')
    assert.equal(built.includes('{{'), false, file)
    assert.equal(built.includes('<!--'), false, file)
    const json = built.match(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/)
    assert.ok(json, file)
    const data = JSON.parse(json[1])
    const faq = data['@graph'].find((node) => node['@type'] === 'FAQPage')
    assert.ok(faq?.mainEntity?.length, file)
    assert.equal(data['@graph'].some((node) => node['@type'] === 'Organization'), true, file)
    assert.equal(data['@graph'].some((node) => node['@type'] === 'BreadcrumbList'), true, file)
  }
})

async function brokenInternalLinks(html, origin, homeHtml) {
  const pages = new Map([['/', homeHtml]])
  const broken = []
  const hrefs = [...html.matchAll(/href="([^"]+)"/g)].map((match) => match[1])
  for (const href of hrefs) {
    let url
    try {
      url = new URL(href, 'https://www.cgpropz.com')
    } catch {
      broken.push(`${href} -> invalid URL`)
      continue
    }
    if (url.hostname !== 'www.cgpropz.com') continue
    let body = pages.get(url.pathname)
    if (!body) {
      const response = await fetch(origin + url.pathname, { redirect: 'manual' })
      if (response.status !== 200) {
        broken.push(`${href} -> ${response.status}`)
        continue
      }
      body = await response.text()
      pages.set(url.pathname, body)
    }
    if (url.hash && !body.includes(`id="${url.hash.slice(1)}"`)) {
      broken.push(`${href} -> missing ${url.hash}`)
    }
  }
  return broken
}

function count(html, token) {
  return html.split(token).length - 1
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

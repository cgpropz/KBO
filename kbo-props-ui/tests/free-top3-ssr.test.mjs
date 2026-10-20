import assert from 'node:assert/strict'
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import vm from 'node:vm'
import { FREE_TOP3_END, FREE_TOP3_MAX_AGE_MS, FREE_TOP3_SPORTS, FREE_TOP3_STALE_TEXT, FREE_TOP3_START, freeTop3Rows, previewResult, freeTop3Script, patchFreeTop3, previewRows, renderSportFreeTop3 } from '../scripts/freeTop3Html.mjs'
import { refreshFreeTop3 } from '../scripts/freeTop3Client.mjs'
import { homeRootInner } from '../scripts/homeShell.mjs'
import { renderKboPage } from '../scripts/kboSeoPage.mjs'
import { renderSportPages } from '../scripts/publicPages.mjs'
import { writeFreeTop3 } from '../scripts/write-free-top3.mjs'

const NOW = Date.parse('2026-10-19T22:00:00Z') // 6:00 PM ET
const LATER = '2026-10-20T09:30:00Z' // Tue 5:30 AM ET
const EARLIER = '2026-10-19T21:00:00Z' // already started

function kboCard(name, props, start = LATER) {
  return { name, team: 'LG', opponent: 'Kia', games: [], start_time: start, props }
}

function kboBody() {
  return {
    preview: true,
    data: {
      cards: [
        kboCard('Mid', [{ stat: 'Hits', line: 0.5, projection: 0.9, odds_type: 'standard' }]),
        kboCard('Top', [{ stat: 'Hits', line: 0.5, projection: 1.6, odds_type: 'standard' }]),
        kboCard('Low', [{ stat: 'Hits', line: 0.5, projection: 0.7, odds_type: 'standard' }]),
        kboCard('Started', [{ stat: 'Hits', line: 0.5, projection: 1.9, odds_type: 'standard' }], EARLIER),
        kboCard('Pulled', [{ stat: 'Hits', line: 0.5, projection: 1.8, odds_type: 'standard', pp_status: 'removed' }]),
        kboCard('Demon', [{ stat: 'Hits', line: 1.5, projection: 2.8, odds_type: 'demon' }]),
        kboCard('NoModel', [{ stat: 'Hits', line: 0.5, projection: null, odds_type: 'standard' }]),
      ],
    },
  }
}

test('server rows use the landing CG Score order and drop started, pulled, non-standard and unmodeled props', () => {
  const rows = freeTop3Rows('kbo', kboBody(), NOW)
  assert.ok(rows.length <= 3)
  const names = rows.map((row) => row.player)
  for (const out of ['Started', 'Pulled', 'Demon', 'NoModel']) assert.equal(names.includes(out), false, out)
  assert.equal(names[0], 'Top')
  for (let i = 1; i < rows.length; i += 1) assert.ok(rows[i - 1].score >= rows[i].score)
  assert.deepEqual(freeTop3Rows('kbo', { ...kboBody(), preview: false }, NOW), [])
  assert.deepEqual(freeTop3Rows('kbo', null, NOW), [])
})

test('the rendered block carries a game-day date stamp in ET and escapes names', () => {
  const sport = { id: 'kbo', name: 'KBO' }
  const rows = [{ player: 'A <b>', stat: 'Hits', line: 0.5, side: 'OVER', score: 88.04, team: 'LG', opponent: 'Kia', start: LATER }]
  const html = renderSportFreeTop3({ sport, rows, now: NOW })
  assert.match(html, /<h2>Today's free KBO top 3<\/h2>/)
  assert.match(html, /Next game day: <time datetime="2026-10-20">Tue, Oct 20, 2026<\/time> \(ET\) · as of Mon, Oct 19, 6:00 PM ET/)
  assert.match(html, /A &lt;b&gt;/)
  assert.match(html, /Hits Over 0\.5 · CG Score 88\.0/)
  assert.match(html, /data-start="2026-10-20T09:30:00\.000Z"/)
  assert.match(html, /Tue 5:30 AM ET/)
  assert.match(html, /Standard lines only, ranked by CG Score\./)
  const empty = renderSportFreeTop3({ sport, rows: [], now: NOW })
  assert.match(empty, /No KBO free top 3 is posted right now\./)
})

test('static pages ship the marker with the empty fallback; the build fills it', async () => {
  const pages = Object.fromEntries(renderSportPages().map((page) => [page.path, page.html]))
  for (const html of [pages['/nfl-player-props'], pages['/nhl-player-props'], pages['/wnba-player-props'], renderKboPage()]) {
    assert.ok(html.includes(FREE_TOP3_START) && html.includes(FREE_TOP3_END))
    assert.match(html, /<section id="free-top-3">/)
    // The committed fallback makes no claim and carries no build clock.
    assert.match(html, /Check the live board for today's free [A-Z]+ top 3\./)
    assert.equal(html.includes('free top 3 is posted right now'), false)
    assert.equal(/class="free-top3-block"[^>]*data-built/.test(html), false)
  }
  assert.equal(pages['/nba-player-props'].includes(FREE_TOP3_START), false)
  assert.ok(homeRootInner().includes(FREE_TOP3_START))

  const dist = mkdtempSync(join(tmpdir(), 'free-top3-'))
  writeFileSync(join(dist, 'kbo-player-props.html'), renderKboPage())
  writeFileSync(join(dist, 'nhl-player-props.html'), pages['/nhl-player-props'])
  writeFileSync(join(dist, 'index.html'), `<div id="root">${homeRootInner()}</div>`)
  const asked = []
  const fetchImpl = async (url) => {
    asked.push(url)
    if (url.endsWith('ds=prizepicks_props')) return { ok: true, json: async () => kboBody() }
    if (url.endsWith('ds=nhl_projections')) return { ok: false, json: async () => ({}) }
    throw new Error('network down')
  }
  const result = await writeFreeTop3({ distDir: dist, origin: 'https://example.test', fetchImpl, now: NOW, clientModule: async () => '/assets/free-top3-test.js' })
  assert.equal(result.moduleSrc, '/assets/free-top3-test.js')
  assert.ok(asked.every((url) => url.startsWith('https://example.test/api/data?ds=')))
  assert.equal(asked.some((url) => /authorization|token/i.test(url)), false)
  assert.equal(result.counts.kbo > 0, true)
  assert.equal(result.counts.nhl, 0)
  assert.deepEqual(result.failed.sort(), ['nfl', 'nhl', 'wnba'])
  const kbo = readFileSync(join(dist, 'kbo-player-props.html'), 'utf8')
  assert.match(kbo, /<strong>Top<\/strong>/)
  assert.equal(kbo.includes('Pulled'), false)
  assert.equal(kbo.split(FREE_TOP3_START).length - 1, 1)
  assert.equal(kbo.includes('<!--'), false)
  // NHL answered HTTP 500: out-of-date note, no rows, a build clock, never "nothing posted".
  const nhl = readFileSync(join(dist, 'nhl-player-props.html'), 'utf8')
  assert.equal(nhl.includes('free top 3 is posted right now'), false)
  assert.ok(nhl.includes(FREE_TOP3_STALE_TEXT))
  assert.match(nhl, /data-sport="nhl" data-built="2026-10-19T22:00:00\.000Z" data-live data-failed>/)
  assert.equal(/<ol class="free-top3">/.test(nhl.split(FREE_TOP3_START)[1]), false)
  assert.match(kbo, /data-sport="kbo" data-built="2026-10-19T22:00:00\.000Z" data-live>/)
  assert.match(kbo, /"\/assets\/free-top3-test\.js"/)
  const home = readFileSync(join(dist, 'index.html'), 'utf8')
  assert.equal(/" data-live>/.test(home), false)
  assert.match(home, /<h3>Today's free KBO top 3<\/h3>/)
  assert.match(home, /<h3>Today's free NFL top 3<\/h3>/)
})

test('patching is idempotent and leaves pages without the marker alone', () => {
  const html = `<p>a</p>${FREE_TOP3_START}old${FREE_TOP3_END}<p>b</p>`
  const once = patchFreeTop3(html, 'new')
  assert.equal(patchFreeTop3(once, 'new'), once)
  assert.equal(once.includes('old'), false)
  assert.equal(patchFreeTop3('<p>none</p>', 'new'), '<p>none</p>')
})

const NHL_BODY = {
  preview: true,
  data: [
    { player: 'Cutter Gauthier', team: 'ANA', prop: 'Shots On Goal', line: 2.5, projection: 4.1, oddsType: 'standard' },
    { player: 'Alex Tuch', team: 'BUF', prop: 'Shots On Goal', line: 2.5, projection: 3.9, oddsType: 'standard' },
  ],
}
const NHL_LINEUPS = { data: [{ injuries: { ANA: [{ name: 'Cutter Gauthier', status: 'out' }] } }] }

test('lineup feeds match the landing, drop OUT players, and a missing feed fails closed', () => {
  const byId = Object.fromEntries(FREE_TOP3_SPORTS.map((sport) => [sport.id, sport]))
  assert.equal(byId.nfl.lineups, 'nfl_lineups')
  assert.equal(byId.wnba.lineups, 'wnba_lineups')
  assert.equal(byId.nhl.lineups, 'nhl_lineups')
  assert.equal(byId.kbo.lineups, null)
  assert.deepEqual(previewRows(byId.nhl, NHL_BODY, NHL_LINEUPS, NOW).map((row) => row.player), ['Alex Tuch'])
  assert.deepEqual(previewRows(byId.nhl, NHL_BODY, null, NOW), [])
  assert.ok(previewRows(byId.kbo, kboBody(), null, NOW).length > 0)
})

test('the build reads each lineup feed; a failed feed shows the out-of-date note, not an empty board', async () => {
  const dist = mkdtempSync(join(tmpdir(), 'free-top3-lu-'))
  const pages = Object.fromEntries(renderSportPages().map((page) => [page.path, page.html]))
  writeFileSync(join(dist, 'nhl-player-props.html'), pages['/nhl-player-props'])
  const asked = []
  const ok = (body) => ({ ok: true, json: async () => body })
  const run = (lineupsUp) => writeFreeTop3({
    distDir: dist, origin: 'https://example.test', now: NOW, clientModule: false,
    fetchImpl: async (url) => {
      asked.push(url)
      if (url.endsWith('ds=nhl_projections')) return ok(NHL_BODY)
      if (url.endsWith('ds=nhl_lineups') && lineupsUp) return ok(NHL_LINEUPS)
      return { ok: false, json: async () => ({}) }
    },
  })
  const up = await run(true)
  assert.ok(asked.includes('https://example.test/api/data?ds=nhl_lineups'))
  assert.equal(up.counts.nhl, 1)
  const html = readFileSync(join(dist, 'nhl-player-props.html'), 'utf8')
  assert.equal(html.includes('Cutter Gauthier'), false)
  assert.match(html, /Alex Tuch/)
  const down = await run(false)
  assert.equal(down.counts.nhl, 0)
  assert.ok(down.failed.includes('nhl'))
  assert.equal(up.failed.includes('nhl'), false)
  const downHtml = readFileSync(join(dist, 'nhl-player-props.html'), 'utf8')
  assert.ok(downHtml.includes(FREE_TOP3_STALE_TEXT))
  assert.equal(downHtml.includes('free top 3 is posted right now'), false)
})

// Minimal DOM for the inline script and the browser module.
function fakeDom(blocks) {
  const make = (spec) => {
    const block = {
      attrs: { 'data-sport': spec.sport, ...(spec.built ? { 'data-built': spec.built } : {}), ...(spec.live ? { 'data-live': '' } : {}) },
      stamp: { textContent: 'as of' },
      ol: { children: spec.starts.map((start) => ({ start, removed: false })) },
      outerHTML: null,
      getAttribute(name) { return this.attrs[name] ?? null },
      querySelector(sel) {
        if (sel === '.free-top3') return this.ol
        if (sel === '.free-top3-stamp') return this.stamp
        return null
      },
      querySelectorAll(sel) {
        if (sel !== '.free-top3 li[data-start]' || !this.ol) return []
        return this.ol.children.map((li) => ({
          getAttribute: () => li.start,
          remove: () => { block.ol.children = block.ol.children.filter((x) => x !== li) },
        }))
      },
    }
    const ol = block.ol
    ol.remove = () => { block.ol = null }
    if (spec.noList) block.ol = null
    if (spec.stamp) block.stamp.textContent = spec.stamp
    return block
  }
  const all = blocks.map(make)
  return {
    blocks: all,
    querySelectorAll(sel) {
      if (sel === '.free-top3-block') return all
      if (sel === '.free-top3-block[data-live]') return all.filter((b) => 'data-live' in b.attrs)
      return []
    },
    querySelector(sel) { return this.querySelectorAll(sel)[0] || null },
  }
}

function runScript(script, document, now, importer) {
  const code = script.replace(/^<script>/, '').replace(/<\/script>$/, '').replace('import(S)', '__import(S)')
  vm.runInNewContext(code, { document, Date: { now: () => now, parse: Date.parse }, __import: importer })
}

test('the inline script hides rows past the max age and drops started games', () => {
  const doc = fakeDom([
    { sport: 'kbo', built: new Date(NOW).toISOString(), starts: [LATER, EARLIER] },
    { sport: 'nfl', built: new Date(NOW - FREE_TOP3_MAX_AGE_MS - 1).toISOString(), starts: [LATER] },
    { sport: 'nhl', built: new Date(NOW).toISOString(), starts: [EARLIER] },
  ])
  runScript(freeTop3Script(''), doc, NOW, () => { throw new Error('no module') })
  const [kbo, nfl, nhl] = doc.blocks
  assert.equal(kbo.ol.children.length, 1)
  assert.equal(nfl.ol, null)
  assert.equal(nfl.stamp.textContent, FREE_TOP3_STALE_TEXT)
  assert.equal(nhl.ol, null)
  assert.match(nhl.stamp.textContent, /games have started/)
})

test('a failed live re-check hides the rows on the sport pages', async () => {
  const doc = fakeDom([{ sport: 'kbo', built: new Date(NOW).toISOString(), starts: [LATER], live: true }])
  let rejected
  const done = new Promise((resolve) => { rejected = resolve })
  runScript(freeTop3Script('/assets/x.js'), doc, NOW, (src) => {
    assert.equal(src, '/assets/x.js')
    const p = Promise.reject(new Error('blocked'))
    p.catch(() => setTimeout(rejected, 0))
    return p
  })
  await done
  assert.equal(doc.blocks[0].ol, null)
  assert.equal(doc.blocks[0].stamp.textContent, FREE_TOP3_STALE_TEXT)
})

test('the browser module re-reads the anonymous preview and re-renders with lineups', async () => {
  const doc = fakeDom([
    { sport: 'nhl', built: new Date(NOW).toISOString(), starts: [], live: true },
    { sport: 'kbo', built: new Date(NOW).toISOString(), starts: [LATER], live: true },
  ])
  const asked = []
  const fetchImpl = async (url, opts) => {
    asked.push([url, opts])
    if (url === '/api/data?ds=nhl_projections') return { ok: true, json: async () => NHL_BODY }
    if (url === '/api/data?ds=nhl_lineups') return { ok: true, json: async () => NHL_LINEUPS }
    if (url === '/api/data?ds=prizepicks_props') return { ok: true, json: async () => ({ preview: true, data: { cards: [], kbo_hold: true } }) }
    return { ok: false, json: async () => ({}) }
  }
  await refreshFreeTop3({ root: doc, fetchImpl, clock: () => NOW })
  assert.ok(asked.every(([, opts]) => opts.credentials === 'omit' && !opts.headers.authorization))
  const [nhl, kbo] = doc.blocks
  assert.match(nhl.outerHTML, /Alex Tuch/)
  assert.equal(nhl.outerHTML.includes('Cutter Gauthier'), false)
  assert.match(nhl.outerHTML, /data-live/)
  assert.match(kbo.outerHTML, /No KBO free top 3 is posted right now\./)
})

test('a failed live re-check keeps the rows hidden with the out-of-date note, not an empty-board claim', async () => {
  const doc = fakeDom([
    { sport: 'nhl', built: new Date(NOW).toISOString(), starts: [LATER], live: true },
    { sport: 'kbo', built: new Date(NOW).toISOString(), starts: [LATER], live: true },
    { sport: 'nfl', built: new Date(NOW).toISOString(), starts: [LATER], live: true },
  ])
  const fetchImpl = async (url) => {
    if (url === '/api/data?ds=nhl_projections') return { ok: true, json: async () => NHL_BODY }
    if (url === '/api/data?ds=nhl_lineups') return { ok: false, json: async () => ({}) }
    if (url === '/api/data?ds=prizepicks_props') throw new Error('network')
    return { ok: true, json: async () => ({ error: 'forbidden' }) }
  }
  await refreshFreeTop3({ root: doc, fetchImpl, clock: () => NOW })
  for (const block of doc.blocks) {
    assert.equal(block.outerHTML, null)
    assert.equal(block.ol, null)
    assert.equal(block.stamp.textContent, FREE_TOP3_STALE_TEXT)
  }
})

test('the build-time stamp and rows are data-nosnippet; the heading and note stay indexable', () => {
  const html = renderSportFreeTop3({
    sport: FREE_TOP3_SPORTS.find((s) => s.id === 'kbo'),
    rows: [{ player: 'Kim', stat: 'Hits', line: 0.5, side: 'OVER', score: 70, start: new Date(LATER).toISOString() }],
    now: NOW,
  })
  const snip = html.match(/<div data-nosnippet>([\s\S]*?)<\/ol><\/div>/)
  assert.ok(snip, 'rows wrapped in data-nosnippet')
  assert.match(snip[1], /free-top3-stamp/)
  assert.match(snip[1], /<ol class="free-top3">/)
  assert.ok(html.indexOf('<h2>') < html.indexOf('data-nosnippet'))
  assert.match(html.slice(html.indexOf('</ol></div>')), /class="note"/)
})

test('previewResult tells a failed read from an empty one', () => {
  const nhl = FREE_TOP3_SPORTS.find((x) => x.id === 'nhl')
  const kbo = FREE_TOP3_SPORTS.find((x) => x.id === 'kbo')
  assert.equal(previewResult(nhl, null, NHL_LINEUPS, NOW).failed, true)
  assert.equal(previewResult(nhl, { error: 'Forbidden' }, NHL_LINEUPS, NOW).failed, true)
  assert.equal(previewResult(nhl, NHL_BODY, null, NOW).failed, true)
  assert.equal(previewResult(nhl, NHL_BODY, { data: null }, NOW).failed, true)
  assert.equal(previewResult(nhl, NHL_BODY, NHL_LINEUPS, NOW).failed, false)
  const held = previewResult(kbo, { preview: true, data: { cards: [], kbo_hold: true } }, null, NOW)
  assert.deepEqual(held, { rows: [], failed: false })
})

test('failed and empty built blocks carry data-built; only an empty read says nothing is posted', () => {
  const sport = FREE_TOP3_SPORTS.find((x) => x.id === 'nhl')
  const failed = renderSportFreeTop3({ sport, rows: [], now: NOW, failed: true, live: true })
  assert.match(failed, /data-built="2026-10-19T22:00:00\.000Z" data-live data-failed>/)
  assert.ok(failed.includes(`<p class="free-top3-stamp">${FREE_TOP3_STALE_TEXT}</p>`))
  assert.equal(failed.includes('posted right now'), false)
  assert.equal(failed.includes('<ol'), false)
  const empty = renderSportFreeTop3({ sport, rows: [], now: NOW })
  assert.match(empty, /data-built="2026-10-19T22:00:00\.000Z"/)
  assert.match(empty, /<p class="free-top3-stamp">No NHL free top 3 is posted right now\.<\/p>/)
})

test('the inline script ages out and fails over blocks with no list, rewriting the stamp', async () => {
  const doc = fakeDom([
    { sport: 'nhl', built: new Date(NOW - FREE_TOP3_MAX_AGE_MS - 1).toISOString(), starts: [], noList: true, stamp: 'No NHL free top 3 is posted right now.' },
    { sport: 'kbo', built: new Date(NOW).toISOString(), starts: [], noList: true, live: true, stamp: 'No KBO free top 3 is posted right now.' },
  ])
  let rejected
  const done = new Promise((resolve) => { rejected = resolve })
  runScript(freeTop3Script('/assets/x.js'), doc, NOW, () => {
    const p = Promise.reject(new Error('blocked'))
    p.catch(() => setTimeout(rejected, 0))
    return p
  })
  await done
  assert.equal(doc.blocks[0].stamp.textContent, FREE_TOP3_STALE_TEXT)
  assert.equal(doc.blocks[1].stamp.textContent, FREE_TOP3_STALE_TEXT)
})

test('the browser module treats a null lineup feed as a failed read', async () => {
  const doc = fakeDom([
    { sport: 'nhl', built: new Date(NOW).toISOString(), starts: [LATER], live: true },
    { sport: 'wnba', built: new Date(NOW).toISOString(), starts: [], noList: true, live: true, stamp: 'No WNBA free top 3 is posted right now.' },
  ])
  const fetchImpl = async (url) => {
    if (url === '/api/data?ds=nhl_projections') return { ok: true, json: async () => NHL_BODY }
    if (url === '/api/data?ds=nhl_lineups') return { ok: true, json: async () => ({ data: null }) }
    return { ok: false, json: async () => ({}) }
  }
  await refreshFreeTop3({ root: doc, fetchImpl, clock: () => NOW })
  for (const block of doc.blocks) {
    assert.equal(block.outerHTML, null)
    assert.equal(block.ol, null)
    assert.equal(block.stamp.textContent, FREE_TOP3_STALE_TEXT)
  }
})

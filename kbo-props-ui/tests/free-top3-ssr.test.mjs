import assert from 'node:assert/strict'
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { FREE_TOP3_END, FREE_TOP3_START, freeTop3Rows, patchFreeTop3, renderSportFreeTop3 } from '../scripts/freeTop3Html.mjs'
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
  assert.match(html, /Next game day: <time datetime="2026-10-20">Tue, Oct 20, 2026<\/time> \(ET\) · as of 6:00 PM ET/)
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
    assert.match(html, /free top 3 is posted right now/)
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
  const result = await writeFreeTop3({ distDir: dist, origin: 'https://example.test', fetchImpl, now: NOW })
  assert.ok(asked.every((url) => url.startsWith('https://example.test/api/data?ds=')))
  assert.equal(asked.some((url) => /authorization|token/i.test(url)), false)
  assert.equal(result.counts.kbo > 0, true)
  assert.equal(result.counts.nhl, 0)
  const kbo = readFileSync(join(dist, 'kbo-player-props.html'), 'utf8')
  assert.match(kbo, /<strong>Top<\/strong>/)
  assert.equal(kbo.includes('Pulled'), false)
  assert.equal(kbo.split(FREE_TOP3_START).length - 1, 1)
  assert.equal(kbo.includes('<!--'), false)
  const nhl = readFileSync(join(dist, 'nhl-player-props.html'), 'utf8')
  assert.match(nhl, /No NHL free top 3 is posted right now\./)
  const home = readFileSync(join(dist, 'index.html'), 'utf8')
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

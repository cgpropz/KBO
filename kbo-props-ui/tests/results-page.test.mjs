import assert from 'node:assert/strict'
import test from 'node:test'
import { finishRecord, formatHitRate, formatWlp } from '../src/resultsLedger.js'
import { loadResultsSnapshot, renderResultsPage } from '../scripts/resultsPage.mjs'

test('a record keeps pushes in W-L-P and voids out of n', () => {
  const record = finishRecord({ hits: 7, misses: 5, pushes: 1, voids: 2 })
  assert.equal(formatWlp(record), '7-5-1')
  assert.equal(record.n, 13)
  assert.equal(record.small, true)
  assert.equal(formatHitRate(record.rate), '58.3%')
})

test('the results page uses the ledger totals and stays inside the copy rules', () => {
  const snapshot = loadResultsSnapshot()
  assert.equal(snapshot.sports.nfl.member.hits, 788)
  assert.equal(snapshot.sports.nfl.member.misses, 787)
  assert.equal(snapshot.source, 'public.qa_pick_ledger')
  const html = renderResultsPage(snapshot).html
  assert.match(html, /788-787-52/)
  assert.match(html, /Every graded pick/)
  assert.match(html, /54\.2% is the reference break-even/)
  assert.match(html, /does not mean every slip makes money/)
  assert.match(html, /it counts in W-L-P but not in the hit rate/)
  assert.match(html, /left out of the record/)
  assert.equal(html.includes('[confirm]'), false)
  assert.equal(html.includes('CONFIRM FEATURE'), false)
  assert.equal(/before lock/i.test(html), false)
  assert.match(html, /Past results do not guarantee future results/)
  assert.equal(html.includes('PrizePicks logo'), false)
  assert.equal(/<img[^>]+prizepicks/i.test(html), false)
  const text = html.replace(/<script[\s\S]*?<\/script>/g, ' ').replace(/<style[\s\S]*?<\/style>/g, ' ')
  assert.equal(/\bprofit\b/i.test(text), false)
  assert.equal(/\bguaranteed\b/i.test(text), false)
  assert.equal(/\bprinting\b/i.test(text), false)
  assert.equal(/\bROI\b/.test(text), false)
  assert.equal(/\bwinner\b/i.test(text), false)
  assert.equal(/\bofficial\b/i.test(text), false)
  assert.equal(/\bpartner\b/i.test(text), false)
  assert.equal(/powered by/i.test(text), false)
  assert.equal(/\bapproved\b/i.test(text), false)
})

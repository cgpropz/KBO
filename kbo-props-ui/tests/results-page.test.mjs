import assert from 'node:assert/strict'
import { existsSync } from 'node:fs'
import test from 'node:test'
import { handleDataRequest, RESULTS_CACHE } from '../api/data.js'
import { POSTED_TIME_NOTE, RESULTS_DESCRIPTION, renderResultsPage } from '../scripts/resultsPage.mjs'
import {
  buildResultsModel,
  finishRecord,
  formatHitRate,
  formatWlp,
  gradeCode,
  resultLabel,
  selectResultsRows,
} from '../src/resultsLedger.js'

test('a record keeps pushes in W-L-P and voids out of n', () => {
  const record = finishRecord({ hits: 7, misses: 5, pushes: 1, voids: 2 })
  assert.equal(formatWlp(record), '7-5-1')
  assert.equal(record.n, 13)
  assert.equal(record.small, true)
  assert.equal(formatHitRate(record.rate), '58.3%')
})

test('ungraded rows are dropped and only a graded void is VOID', () => {
  assert.equal(resultLabel('V'), 'VOID')
  assert.equal(resultLabel(null), '')
  assert.equal(resultLabel('Ungraded'), '')
  assert.equal(gradeCode({ result: null, graded_at: null }), null)
  assert.equal(gradeCode({ result: 'Hit', graded_at: null }), null)
  assert.equal(gradeCode({ result: 'Ungraded', graded_at: '2026-10-27T03:00:00Z' }), null)
  assert.equal(gradeCode({ result: 'Void', graded_at: '2026-10-27T03:00:00Z' }), 'V')

  const rows = [
    base({ id: 1, player: 'Hit Player', result: 'Hit', actual: 6 }),
    base({ id: 2, player: 'Miss Player', result: 'Miss', actual: 2, prop: 'Rush Yards', line: 40.5 }),
    base({ id: 3, player: 'Push Player', slate_date: '2026-10-18', result: 'Push', actual: 4.5, graded_at: '2026-10-19T02:00:00Z' }),
    base({ id: 4, player: 'Real Void', slate_date: '2026-10-18', result: 'Void', actual: null, graded_at: '2026-10-28T04:00:00Z' }),
    base({
      id: 5, player: 'Caleb Williams', slate_date: '2026-11-02', result: null, graded_at: null,
      start_time: '2026-11-03T01:15:00Z', snapshot_at: '2026-11-02T15:47:00Z', actual: null,
    }),
    base({ id: 6, player: 'Still Open', result: 'Ungraded', graded_at: '2026-10-27T03:00:00Z' }),
    base({ id: 7, player: 'No Stamp', result: 'Hit', graded_at: null }),
    base({ id: 8, player: 'Late Post', result: 'Hit', snapshot_at: '2026-10-26T18:00:00Z', graded_at: '2026-10-27T03:00:00Z' }),
    base({ id: 9, player: 'Demon Line', odds_type: 'demon', result: 'Hit' }),
    base({ id: 10, player: 'Old Line', prop: 'Receptions', line: 1.5, result: 'Miss', snapshot_at: '2026-10-26T14:00:00Z' }),
    base({ id: 11, player: 'Old Line', prop: 'Receptions', line: 2.5, result: 'Hit', snapshot_at: '2026-10-26T15:00:00Z', actual: 4 }),
    base({ id: 12, player: 'Free Hit', free_top3: true, result: 'Hit', prop: 'Passing Yards' }),
  ]
  const kept = selectResultsRows(rows).map((row) => row.player).sort()
  assert.deepEqual(kept, ['Free Hit', 'Hit Player', 'Miss Player', 'Old Line', 'Push Player', 'Real Void'])

  const model = buildResultsModel(rows, new Date('2026-10-30T18:00:00Z'))
  assert.equal(model.earliestSlate, '2026-10-18')
  assert.equal(model.latestSlate, '2026-10-26')
  assert.equal(model.updatedAt, '2026-10-28T04:00:00.000Z')
  assert.equal(model.seasonMatchesLast30, true)
  assert.equal(model.sports.nfl.member.hits, 2)
  assert.equal(model.sports.nfl.member.misses, 1)
  assert.equal(model.sports.nfl.member.pushes, 1)
  assert.equal(model.sports.nfl.member.voids, 1)
  assert.equal(model.sports.nfl.free.hits, 1)
  assert.equal(model.history.some((row) => row.player === 'Caleb Williams'), false)
  assert.equal(model.history.some((row) => row.date === '2026-11-02'), false)
  assert.equal(model.history.some((row) => row.player === 'Real Void' && row.result === 'V'), true)

  const later = buildResultsModel(rows, new Date('2026-12-30T18:00:00Z'))
  assert.equal(later.seasonMatchesLast30, false)
})

test('the results page uses graded rows only and stays inside the copy rules', () => {
  const model = buildResultsModel([
    base({ id: 1, player: 'Hit Player', result: 'Hit', actual: 6 }),
    base({ id: 2, player: 'Miss Player', result: 'Miss', actual: 2 }),
    base({ id: 3, player: 'Push Player', result: 'Push', actual: 4.5 }),
    base({ id: 4, player: 'Real Void', result: 'Void', actual: null, graded_at: '2026-10-28T04:00:00Z' }),
    base({
      id: 5, player: 'Caleb Williams', slate_date: '2026-11-02', result: null, graded_at: null,
      start_time: '2026-11-03T01:15:00Z', snapshot_at: '2026-11-02T15:47:00Z',
    }),
  ], new Date('2026-10-30T18:00:00Z'))
  assert.equal(model.source, 'public.qa_pick_ledger')
  const page = renderResultsPage(model)
  const html = page.html
  assert.match(html, /1-1-1/)
  assert.match(html, /Every graded pick/)
  assert.match(html, /Wins and losses \(W-L-P\)/)
  assert.match(page.description, /wins and losses \(W-L-P\)/)
  assert.match(html, /wins and losses \(W-L-P\)/)
  assert.equal(html.includes('Hits and misses'), false)
  assert.equal(html.includes('Caleb Williams'), false)
  assert.equal(html.includes('2026-11-02'), false)
  assert.equal(html.includes('Nov 2'), false)
  assert.match(html, /Real Void/)
  assert.equal((html.match(/class="chip V"/g) || []).length, 2)
  assert.match(html, new RegExp(POSTED_TIME_NOTE.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')))
  assert.match(html, /54\.2% is the reference break-even/)
  assert.match(html, /does not mean every slip makes money/)
  assert.match(html, /it counts in W-L-P but not in the hit rate/)
  assert.match(html, /left out of the record/)
  assert.equal(html.includes('[confirm]'), false)
  assert.equal(html.includes('CONFIRM FEATURE'), false)
  assert.equal(/before lock/i.test(html), false)
  assert.match(html, /Past results do not guarantee future results/)
  assert.equal(html.includes(RESULTS_DESCRIPTION), true)
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
  assert.equal(/\block\b/i.test(text), false)
})

test('the results page is not a committed snapshot', () => {
  assert.equal(existsSync(new URL('../api/_resultsSnapshot.json', import.meta.url)), false)
  assert.equal(existsSync(new URL('../public/results.html', import.meta.url)), false)
})

test('/results reads qa_pick_ledger through the board_reader function', async () => {
  const rows = [
    base({ id: 1, player: 'Hit Player', result: 'Hit' }),
    base({
      id: 5, player: 'Caleb Williams', slate_date: '2026-11-02', result: null, graded_at: null,
      start_time: '2026-11-03T01:15:00Z', snapshot_at: '2026-11-02T15:47:00Z',
    }),
  ]
  let rpcName = ''
  const res = mockRes()
  await handleDataRequest({ method: 'GET', query: { ds: 'results' }, headers: {} }, res, {
    rpc(name) {
      rpcName = name
      return { data: rows, error: null }
    },
    from() { throw new Error('direct table read') },
  })
  assert.equal(rpcName, 'board_reader_results_rows')
  assert.equal(res.statusCode, 200)
  assert.equal(res.headers['content-type'], 'text/html; charset=utf-8')
  assert.equal(res.headers['cache-control'], RESULTS_CACHE)
  assert.match(res.body, /Hit Player/)
  assert.equal(res.body.includes('Caleb Williams'), false)
  assert.match(res.body, /Wins and losses \(W-L-P\)/)

  const failed = mockRes()
  await handleDataRequest({ method: 'GET', query: { ds: 'results' }, headers: {} }, failed, {
    rpc() { return { data: null, error: { message: 'nope' } } },
  })
  assert.equal(failed.statusCode, 503)
  assert.equal(failed.headers['cache-control'], 'no-store')
  assert.equal(String(failed.body).includes('788-787-52'), false)

  const posted = mockRes()
  await handleDataRequest({ method: 'POST', query: { ds: 'results' }, headers: {} }, posted, {
    rpc() { throw new Error('should not read') },
  })
  assert.equal(posted.statusCode, 405)
})

function base(overrides) {
  return {
    id: 1,
    sport: 'nfl',
    slate_date: '2026-10-26',
    player: 'Kept',
    prop: 'Receptions',
    line: 4.5,
    side: 'O',
    odds_type: 'standard',
    cg_score: 55,
    free_top3: false,
    start_time: '2026-10-26T17:00:00Z',
    snapshot_at: '2026-10-26T12:00:00Z',
    actual: 6,
    result: 'Hit',
    graded_at: '2026-10-27T03:00:00Z',
    ...overrides,
  }
}

function mockRes() {
  return {
    statusCode: 200,
    headers: {},
    body: undefined,
    setHeader(key, value) { this.headers[key.toLowerCase()] = value },
    end(body) { this.body = body },
  }
}

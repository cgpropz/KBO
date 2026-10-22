import assert from 'node:assert/strict'
import test from 'node:test'
import vm from 'node:vm'
import { FREE_TOP3_MAX_AGE_MS, FREE_TOP3_STALE_TEXT, freeTop3Rows, freeTop3Script, renderSportFreeTop3 } from '../scripts/freeTop3Html.mjs'
import { rowStartMs, rowStartPassed } from '../src/etStart.js'
import { publicFreeTopRows } from '../src/publicBoard.js'

const NHL = { id: 'nhl', name: 'NHL' }
const NFL = { id: 'nfl', name: 'NFL' }

function row(player, score, start, extra = {}) {
  return {
    player,
    stat: 'Shots On Goal',
    line: 1.5,
    projection: 3,
    side: 'OVER',
    score,
    rawScore: score,
    start,
    team: extra.team || 'AAA',
    opponent: extra.opponent || 'BBB',
    ...extra,
  }
}

function li(html, player) {
  const match = html.match(new RegExp(`<li[^>]*>[^]*?${player}[^]*?</li>`))
  assert.ok(match, player)
  return match[0]
}

test('a finished game is dropped and does not take a free slot', () => {
  const now = Date.parse('2026-10-22T08:55:00Z') // 4:55 AM ET Thu
  const rows = publicFreeTopRows([
    row('Finished Skater', 110, '2026-10-21T23:30:00Z'),
    row('Thursday Skater', 70, '2026-10-23T01:00:00Z'),
    row('Late Thursday', 60, '2026-10-23T02:00:00Z'),
    row('Early Thursday', 50.1, '2026-10-23T00:30:00Z'),
    row('Date Only Yesterday', 99, null, { gameday: '2026-10-21' }),
  ], 3, now)
  assert.deepEqual(rows.map((item) => item.player), ['Thursday Skater', 'Late Thursday', 'Early Thursday'])
  for (let i = 1; i < rows.length; i += 1) assert.ok(rows[i - 1].score >= rows[i].score)
})

test('a mixed-day NHL slate is labeled per game, not by the earliest start', () => {
  const now = Date.parse('2026-10-21T22:00:00Z') // 6:00 PM ET Wed, before the 7:30 tip
  const rows = publicFreeTopRows([
    row('Thursday One', 80, '2026-10-23T01:00:00Z', { team: 'CGY', opponent: 'MIN' }),
    row('Wednesday One', 90, '2026-10-21T23:30:00Z', { team: 'BUF', opponent: 'PHI' }),
    row('Thursday Two', 70, '2026-10-23T02:00:00Z', { team: 'UTA', opponent: 'SEA' }),
  ], 3, now)
  assert.deepEqual(rows.map((item) => item.player), ['Wednesday One', 'Thursday One', 'Thursday Two'])
  const html = renderSportFreeTop3({ sport: NHL, rows, now })
  assert.equal(/Next game day:|Game days:/.test(html), false)
  const wed = li(html, 'Wednesday One')
  const thu = li(html, 'Thursday One')
  assert.match(wed, /data-day="2026-10-21"/)
  assert.match(wed, /Wed\u00a07:30\u00a0PM\u00a0ET/)
  assert.match(thu, /data-day="2026-10-22"/)
  assert.match(thu, /Thu\u00a09:00\u00a0PM\u00a0ET/)
  assert.equal(/Thu\u00a09:00\u00a0PM\u00a0ET/.test(wed), false)
})

test('NFL Thursday and Sunday games keep their own ET labels and score order', () => {
  const now = Date.parse('2026-10-22T08:55:00Z') // 4:55 AM ET Thu
  const rows = publicFreeTopRows([
    row('Sunday Cap', 100, '2026-10-25T17:00:00Z', { stat: 'Receiving Yards', team: 'CCC', opponent: 'DDD' }),
    row('Sunday Next', 88.4, '2026-10-25T17:00:00Z', { stat: 'Receiving Yards', team: 'CCC', opponent: 'DDD' }),
    row('Thursday Back', 88.3, '2026-10-23T00:15:00Z', { stat: 'Rush Yards', team: 'EEE', opponent: 'FFF' }),
    row('Finished Back', 100, '2026-10-21T23:00:00Z', { stat: 'Rush Yards' }),
  ], 3, now)
  assert.deepEqual(rows.map((item) => item.player), ['Sunday Cap', 'Sunday Next', 'Thursday Back'])
  const html = renderSportFreeTop3({ sport: NFL, rows, now })
  assert.equal(/Next game day:/.test(html), false)
  assert.match(li(html, 'Thursday Back'), /data-day="2026-10-22"/)
  assert.match(li(html, 'Thursday Back'), /Thu\u00a08:15\u00a0PM\u00a0ET/)
  assert.match(li(html, 'Sunday Cap'), /data-day="2026-10-25"/)
  assert.match(li(html, 'Sunday Cap'), /Sun\u00a01:00\u00a0PM\u00a0ET/)
  assert.match(li(html, 'Sunday Next'), /Sun\u00a01:00\u00a0PM\u00a0ET/)
  assert.equal(html.includes('Finished Back'), false)
  assert.match(html, /CG Score 100\.0/)
})

test('an offset-less wall clock is ET, and the ET date flips at midnight', () => {
  const beforeMidnight = Date.parse('2026-10-22T02:00:00Z') // 10:00 PM ET Wed
  const late = row('Late Wednesday', 77, '2026-10-22T03:30:00Z')
  assert.equal(rowStartPassed(late, beforeMidnight), false)
  const lateHtml = renderSportFreeTop3({
    sport: NHL,
    rows: publicFreeTopRows([late], 3, beforeMidnight),
    now: beforeMidnight,
  })
  assert.match(lateHtml, /data-day="2026-10-21"/)
  assert.match(lateHtml, /Wed\u00a011:30\u00a0PM\u00a0ET/)
  assert.equal(/Thu, Oct 22/.test(lateHtml), false)

  const afterMidnight = Date.parse('2026-10-22T04:10:00Z') // 12:10 AM ET Thu
  assert.equal(rowStartPassed(late, afterMidnight), true)
  const kept = publicFreeTopRows([
    late,
    row('After Midnight', 66, '2026-10-22T04:30:00Z'),
    row('Wall Clock', 55, '2026-10-22T00:30:00'),
  ], 3, afterMidnight)
  assert.deepEqual(kept.map((item) => item.player), ['After Midnight', 'Wall Clock'])
  assert.equal(rowStartMs({ start: '2026-10-22T00:30:00' }), Date.parse('2026-10-22T04:30:00Z'))
  const html = renderSportFreeTop3({ sport: NHL, rows: kept, now: afterMidnight })
  assert.match(li(html, 'After Midnight'), /data-day="2026-10-22"/)
  assert.match(li(html, 'After Midnight'), /Thu\u00a012:30\u00a0AM\u00a0ET/)
  assert.match(li(html, 'Wall Clock'), /data-day="2026-10-22"/)
  assert.match(li(html, 'Wall Clock'), /Thu\u00a012:30\u00a0AM\u00a0ET/)
  assert.match(li(html, 'Wall Clock'), /data-start="2026-10-22T04:30:00.000Z"/)

  const afternoon = Date.parse('2026-10-22T21:00:00Z') // 5:00 PM ET Thu
  const wall = row('Thursday Wall', 81, '2026-10-22T20:15:00')
  assert.equal(rowStartPassed(wall, afternoon), false)
  assert.equal(rowStartMs(wall), Date.parse('2026-10-23T00:15:00Z'))
  const wallHtml = renderSportFreeTop3({
    sport: NFL,
    rows: publicFreeTopRows([wall], 3, afternoon),
    now: afternoon,
  })
  assert.match(wallHtml, /Thu\u00a08:15\u00a0PM\u00a0ET/)
  assert.match(wallHtml, /data-day="2026-10-22"/)
})

test('the free preview path drops a finished NHL row before it is baked', () => {
  const now = Date.parse('2026-10-22T08:55:00Z')
  const body = {
    preview: true,
    data: [
      { player: 'Finished Skater', team: 'AAA', opponent: 'BBB', prop: 'Shots On Goal', line: 1.5, projection: 4, oddsType: 'standard', start_time: '2026-10-21T23:30:00Z' },
      { player: 'Thursday Skater', team: 'CCC', opponent: 'DDD', prop: 'Shots On Goal', line: 1.5, projection: 3, oddsType: 'standard', start_time: '2026-10-23T01:00:00Z' },
      { player: 'Later Skater', team: 'EEE', opponent: 'FFF', prop: 'Shots On Goal', line: 2.5, projection: 3.2, oddsType: 'standard', start_time: '2026-10-23T02:00:00Z' },
    ],
  }
  const names = freeTop3Rows('nhl', body, now).map((item) => item.player)
  assert.equal(names.includes('Finished Skater'), false)
  assert.ok(names.includes('Thursday Skater'))
})

test('a stale bake still drops a row whose start has passed', () => {
  const now = Date.parse('2026-10-22T08:55:00Z')
  const built = new Date(now - FREE_TOP3_MAX_AGE_MS - 60_000).toISOString()
  const past = '2026-10-21T23:30:00.000Z'
  const future = '2026-10-23T01:00:00.000Z'
  const dropped = []
  const block = {
    attrs: { 'data-sport': 'nhl', 'data-built': built },
    stamp: { textContent: 'as of' },
    ol: {
      children: [
        { start: past },
        { start: future },
      ],
    },
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
        remove: () => {
          dropped.push(li.start)
          block.ol.children = block.ol.children.filter((item) => item !== li)
        },
      }))
    },
  }
  block.ol.remove = () => { block.ol = null }
  const doc = {
    querySelectorAll(sel) {
      if (sel === '.free-top3-block') return [block]
      return []
    },
    querySelector() { return null },
  }
  const script = freeTop3Script('').replace(/^<script>/, '').replace(/<\/script>$/, '')
  vm.runInNewContext(script, { document: doc, Date: { now: () => now, parse: Date.parse } })
  assert.deepEqual(dropped, [past])
  assert.equal(block.ol, null)
  assert.equal(block.stamp.textContent, FREE_TOP3_STALE_TEXT)
})

test('an all-Sunday NFL top 3 on a Thursday names no game day and labels each pick', () => {
  // Thursday 9:29 AM ET with a TNF game tonight that is not in the top 3.
  const now = Date.parse('2026-10-22T13:29:00Z')
  const input = [
    row('Sunday A', 100, '2026-10-25T17:00:00Z', { stat: 'Receiving Yards', team: 'HOU', opponent: 'NYG' }),
    row('Sunday B', 92.4, '2026-10-25T17:00:00Z', { stat: 'Rush Attempts', team: 'NYG', opponent: 'HOU' }),
    row('Sunday C', 88.4, '2026-10-25T20:25:00Z', { stat: 'Receiving Yards', team: 'AAA', opponent: 'BBB' }),
    row('Thursday D', 84.7, '2026-10-23T00:15:00Z', { stat: 'Rush Yards', team: 'NE', opponent: 'CHI' }),
  ]
  const rows = publicFreeTopRows(input, 3, now)
  // Selection is unchanged: score order, Thursday stays 4th.
  assert.deepEqual(rows.map((item) => item.player), ['Sunday A', 'Sunday B', 'Sunday C'])
  const html = renderSportFreeTop3({ sport: NFL, rows, now })
  assert.equal(/Next game day|Game days/.test(html), false)
  assert.equal(/Sun, Oct 25/.test(html), false)
  assert.match(html, /<p class="free-top3-stamp">Game times in ET · as of Thu, Oct 22, 9:29 AM ET<\/p>/)
  assert.match(li(html, 'Sunday A'), /<time datetime="2026-10-25T17:00:00\.000Z">Sun\u00a01:00\u00a0PM\u00a0ET<\/time>/)
  assert.match(li(html, 'Sunday C'), />Sun\u00a04:25\u00a0PM\u00a0ET<\/time>/)
  // The label never breaks inside: no plain or narrow spaces in any <time>.
  for (const [, label] of html.matchAll(/<time[^>]*>([^<]*)<\/time>/g)) assert.equal(/[ \u202f]/.test(label), false, label)
  // A Thursday pick in the list gets its own label, not the Sunday one.
  const mixed = renderSportFreeTop3({ sport: NFL, rows: publicFreeTopRows([input[0], input[3]], 3, now), now })
  assert.match(li(mixed, 'Thursday D'), />Thu\u00a08:15\u00a0PM\u00a0ET<\/time>/)
})

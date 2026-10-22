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
  assert.equal(/Next game day:/.test(html), false)
  assert.match(html, /Game days:/)
  assert.match(html, /<time datetime="2026-10-21">Wed, Oct 21, 2026<\/time>/)
  assert.match(html, /<time datetime="2026-10-22">Thu, Oct 22, 2026<\/time>/)
  const wed = li(html, 'Wednesday One')
  const thu = li(html, 'Thursday One')
  assert.match(wed, /data-day="2026-10-21"/)
  assert.match(wed, /Wed 7:30 PM ET/)
  assert.match(thu, /data-day="2026-10-22"/)
  assert.match(thu, /Thu 9:00 PM ET/)
  assert.equal(/Thu 9:00 PM ET/.test(wed), false)
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
  assert.match(li(html, 'Thursday Back'), /Thu 8:15 PM ET/)
  assert.match(li(html, 'Sunday Cap'), /data-day="2026-10-25"/)
  assert.match(li(html, 'Sunday Cap'), /Sun 1:00 PM ET/)
  assert.match(li(html, 'Sunday Next'), /Sun 1:00 PM ET/)
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
  assert.match(lateHtml, /Wed 11:30 PM ET/)
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
  assert.match(li(html, 'After Midnight'), /Thu 12:30 AM ET/)
  assert.match(li(html, 'Wall Clock'), /data-day="2026-10-22"/)
  assert.match(li(html, 'Wall Clock'), /Thu 12:30 AM ET/)
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
  assert.match(wallHtml, /Thu 8:15 PM ET/)
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

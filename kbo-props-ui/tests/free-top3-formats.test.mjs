import assert from 'node:assert/strict'
import test from 'node:test'
import { gameAlreadyStarted } from '../src/gameStarted.js'
import { rowStartMs, rowStartPassed } from '../src/etStart.js'
import { nbaHubRows } from '../src/memberHub.js'
import { publicFreeTopRows } from '../src/publicBoard.js'
import { renderSportFreeTop3 } from '../scripts/freeTop3Html.mjs'

// One synthetic row per sport, in the shape that board actually publishes.
// Digits here are fixtures, not a live pull.

const NOW = Date.parse('2026-10-22T08:00:00Z') // 4:00 AM ET Thu, before the KBO first pitch

function ranked(player, score, extra) {
  return {
    player,
    stat: 'Points',
    line: 10.5,
    projection: 14,
    side: 'OVER',
    score,
    rawScore: score,
    team: 'AAA',
    opponent: 'BBB',
    ...extra,
  }
}

test('each sport uses its published start field', () => {
  const nfl = ranked('Thursday Back', 90, {
    stat: 'Rush Yards',
    start_time: '2026-10-22T20:15:00.000-04:00',
    gametime: '20:15',
    gameday: '2026-10-22',
    started: false,
    team: 'NE',
    opponent: 'CHI',
  })
  const nhl = ranked('Thursday Skater', 80, {
    stat: 'Shots On Goal',
    start_time: '2026-10-23T01:00:00Z',
    gameday: '2026-10-22',
    started: false,
  })
  const wnba = ranked('Thursday Guard', 70, {
    start_time: '2026-10-22T23:00:00Z',
    gameDate: '2026-10-22',
    started: false,
  })
  // KBO first pitch is Korea time with a numeric offset, not a naive ET clock.
  const kbo = ranked('Evening Batter', 60, {
    stat: 'Hits',
    start_time: '2026-10-22T18:30:00+09:00',
    game_date: '2026-10-22',
    started: false,
  })

  for (const row of [nfl, nhl, wnba, kbo]) {
    assert.equal(rowStartPassed(row, NOW), false)
    assert.equal(gameAlreadyStarted(row, new Date(NOW)), false)
  }

  assert.equal(rowStartMs(nfl), Date.parse('2026-10-23T00:15:00Z'))
  assert.equal(rowStartMs({ gametime: '20:15', gameday: '2026-10-22' }), null)
  const nflHtml = renderSportFreeTop3({ sport: { id: 'nfl', name: 'NFL' }, rows: [nfl], now: NOW })
  assert.match(nflHtml, /Thu\u00a08:15\u00a0PM\u00a0ET/)
  assert.match(nflHtml, /data-day="2026-10-22"/)

  assert.equal(rowStartMs(nhl), Date.parse('2026-10-23T01:00:00Z'))
  const nhlHtml = renderSportFreeTop3({ sport: { id: 'nhl', name: 'NHL' }, rows: [nhl], now: NOW })
  assert.match(nhlHtml, /Thu\u00a09:00\u00a0PM\u00a0ET/)

  assert.equal(rowStartMs(wnba), Date.parse('2026-10-22T23:00:00Z'))
  const wnbaHtml = renderSportFreeTop3({ sport: { id: 'wnba', name: 'WNBA' }, rows: [wnba], now: NOW })
  assert.match(wnbaHtml, /Thu\u00a07:00\u00a0PM\u00a0ET/)

  // 18:30 KST is 09:30 UTC, 5:30 AM ET.
  assert.equal(rowStartMs(kbo), Date.parse('2026-10-22T09:30:00Z'))
  const kboHtml = renderSportFreeTop3({ sport: { id: 'kbo', name: 'KBO' }, rows: [kbo], now: NOW })
  assert.match(kboHtml, /Thu\u00a05:30\u00a0AM\u00a0ET/)

  const afterNfl = Date.parse('2026-10-23T00:15:00Z')
  assert.equal(gameAlreadyStarted(nfl, new Date(afterNfl)), true)
  assert.equal(rowStartPassed({ ...nfl, started: false }, afterNfl), true)
})

test('a naive start_time_utc is UTC, and a naive start_time stays Eastern', () => {
  const utcNaive = '2026-10-22T00:30:00'
  assert.equal(rowStartMs({ start_time_utc: utcNaive }), Date.parse('2026-10-22T00:30:00Z'))
  assert.equal(rowStartMs({ startTimeUTC: utcNaive }), Date.parse('2026-10-22T00:30:00Z'))
  assert.equal(rowStartMs({ start: utcNaive }), Date.parse('2026-10-22T04:30:00Z'))
  assert.equal(rowStartMs({ start_time: utcNaive }), Date.parse('2026-10-22T04:30:00Z'))
  const beforeUtc = Date.parse('2026-10-22T00:00:00Z')
  const afterUtc = Date.parse('2026-10-22T00:30:00Z')
  assert.equal(gameAlreadyStarted({ start_time_utc: utcNaive }, new Date(beforeUtc)), false)
  assert.equal(gameAlreadyStarted({ start_time_utc: utcNaive }, new Date(afterUtc)), true)
  // The same digits as Eastern have not tipped at 00:30 UTC (that clock is 04:30 UTC).
  assert.equal(gameAlreadyStarted({ start_time: utcNaive }, new Date(afterUtc)), false)
})

test('NBA free top 3 follows started and does not use a missing tip or an old gameDate', () => {
  const players = [
    {
      name: 'Finished Guard',
      team: 'AAA',
      ppAllProps: [{
        stat: 'Points', line: 20.5, projection: 30, odds_type: 'standard', rating: 99,
        opponent: 'BBB', gameDate: '2026-10-22', started: true,
      }],
    },
    {
      name: 'Live Guard',
      team: 'CCC',
      ppAllProps: [{
        stat: 'Points', line: 18.5, projection: 24, odds_type: 'standard', rating: 77,
        opponent: 'DDD', gameDate: '2026-10-21', started: false,
      }],
    },
  ]
  const rows = publicFreeTopRows(nbaHubRows(players), 3, NOW)
  assert.deepEqual(rows.map((row) => row.player), ['Live Guard'])
  assert.equal(gameAlreadyStarted(players[0].ppAllProps[0], new Date(NOW)), true)
  assert.equal(gameAlreadyStarted(players[1].ppAllProps[0], new Date(NOW)), false)
  assert.equal(rows[0].start, '2026-10-21')
  const html = renderSportFreeTop3({ sport: { id: 'nba', name: 'NBA' }, rows, now: NOW })
  assert.equal(html.includes('Finished Guard'), false)
  assert.match(html, /Live Guard/)
  assert.equal(/data-start=/.test(html), false)
})

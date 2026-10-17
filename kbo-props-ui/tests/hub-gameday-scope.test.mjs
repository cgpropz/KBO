import assert from 'node:assert/strict'
import test from 'node:test'
import { etGameday, nextGameday, scopeToGameday, topHubRows, topHitRateRows } from '../src/memberHub.js'

// Fri Oct 16 2026, 8:45 PM ET.
const now = new Date('2026-10-17T00:45:00Z')
const recent = [1, 1, 1, 1, 1, 1, 1, 1, 1, 1]
const row = (player, start, score, hitRate) => ({ player, stat: 'Points', line: 0.5, score, start, team: 'T', opponent: 'O', recent, hitRate, hitHits: 10, hitGames: 10 })
const tonight = row('Tonight A', '2026-10-17T01:00:00Z', 60, 80) // 9 PM ET Fri
const late = row('Tonight B', '2026-10-17T02:00:00Z', 55, 70) // 10 PM ET Fri
const marchenko = row('Marchenko', '2026-10-17T23:00:00Z', 90, 100) // 7 PM ET Sat
const boeser = row('Boeser', '2026-10-17T20:00:00Z', 85, 100) // 4 PM ET Sat

test('ET gameday uses the New York calendar, not UTC', () => {
  assert.equal(etGameday('2026-10-17T01:00:00Z'), '2026-10-16')
  assert.equal(etGameday('2026-10-17T23:00:00Z'), '2026-10-17')
  assert.equal(etGameday('2026-10-17'), '2026-10-17')
  assert.equal(etGameday(null), null)
})

test('hub scopes top 3 and L10 leaders to the next gameday', () => {
  const rows = [marchenko, boeser, tonight, late]
  const day = nextGameday(rows, now)
  assert.equal(day, '2026-10-16')
  const scoped = scopeToGameday(rows, day)
  assert.deepEqual(topHubRows(scoped, 3).map((r) => r.player), ['Tonight A', 'Tonight B'])
  assert.deepEqual(topHitRateRows(scoped, 10).map((r) => r.player), ['Tonight A', 'Tonight B'])
  assert.equal(scoped.length, 2)
})

test('once tonight has started, the hub moves to the next slate', () => {
  const after = new Date('2026-10-17T03:00:00Z') // 11 PM ET Fri
  const day = nextGameday([tonight, late, marchenko, boeser], after)
  assert.equal(day, '2026-10-17')
  assert.deepEqual(scopeToGameday([tonight, marchenko, boeser], day).map((r) => r.player), ['Marchenko', 'Boeser'])
})

test('undated rows stay; no future game leaves rows untouched', () => {
  const undated = row('Undated', null, 50, 60)
  assert.deepEqual(scopeToGameday([undated, marchenko, tonight], '2026-10-16').map((r) => r.player), ['Undated', 'Tonight A'])
  assert.equal(nextGameday([undated], now), null)
  assert.equal(scopeToGameday([undated, tonight], null).length, 2)
})

test('NFL keeps the whole week; daily sports scope to the next gameday', async () => {
  const { hubGamedayFor } = await import('../src/memberHub.js')
  const sun = { start: '2026-10-18T13:00:00-04:00' }
  const mon = { start: '2026-10-19T20:15:00-04:00' }
  assert.equal(hubGamedayFor('nfl', [sun, mon], now), null)
  assert.equal(scopeToGameday([sun, mon], hubGamedayFor('nfl', [sun, mon], now)).length, 2)
  for (const sport of ['nhl', 'wnba', 'kbo', 'nba']) {
    assert.equal(hubGamedayFor(sport, [sun, mon], now), '2026-10-18')
  }
})

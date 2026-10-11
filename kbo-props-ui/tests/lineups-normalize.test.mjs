import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import { normalizeWnbaLineups, wnbaSlateHeading } from '../src/lineups/normalizeWnbaLineups.js'

test('nfl and wnba both render the shared starting lineups board', () => {
  const nfl = readFileSync(new URL('../src/nfl/NflLineups.jsx', import.meta.url), 'utf8')
  const wnba = readFileSync(new URL('../src/wnba/Lineups.jsx', import.meta.url), 'utf8')
  assert.match(nfl, /StartingLineups/)
  assert.match(wnba, /StartingLineups/)
})

test('a schedule-shaped snapshot is kept as the NFL board reads it', () => {
  const row = {
    awayTeam: 'NYL',
    homeTeam: 'ATL',
    gameday: '2026-10-07',
    gametime: '19:30',
    lineups: { NYL: [], ATL: [] },
    spreadLine: -1.5,
  }
  assert.deepEqual(normalizeWnbaLineups([row]), [row])
})

test('the older rotowire snapshot still becomes a lineup card', () => {
  const [game] = normalizeWnbaLineups([{
    gameTime: '7:30 PM ET',
    visitor: { abbr: 'NYL', players: [{ name: 'Sabrina Ionescu', pos: 'G', status: 'expected' }], inactive: [] },
    home: { abbr: 'ATL', players: [], inactive: [{ name: 'Allisha Gray', pos: 'G', status: 'out' }] },
  }])
  assert.equal(game.kickoffLabel, '7:30 PM ET')
  assert.equal(game.lineups.NYL[0].name, 'Sabrina Ionescu')
  assert.equal(game.lineups.NYL[0].status, null)
  assert.equal(game.injuries.ATL[0].status, 'OUT')
  assert.equal(game.spreadLine, null)
  assert.equal(game.conditions, '—')
  assert.equal(wnbaSlateHeading([game]), 'Starting Lineups')
})

test('the slate title uses the game date and never a made-up week', () => {
  assert.equal(wnbaSlateHeading([{ gameday: '2026-10-07', awayTeam: 'NYL' }]), 'October 7 Starting Lineups')
})

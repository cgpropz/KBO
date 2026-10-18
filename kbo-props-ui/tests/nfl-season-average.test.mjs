import test from 'node:test'
import assert from 'node:assert/strict'
import { nflSeasonAverage } from '../src/nfl/seasonAverage.js'

// Dameon Pierce, Receiving Yards (10/18 board): five 2025 games at 0 and one
// 2026 game, 2 catches for -2 yards (nflverse week 5). The old tile showed
// the all-window mean, -0.3.
const pierce = {
  player: 'Dameon Pierce', prop: 'Receiving Yards', line: 9.5,
  seasonAverage: -0.3, recent: [0, 0, 0, 0, 0, -2], gameSeasons: [2025, 2025, 2025, 2025, 2025, 2026], priorSeasonLabel: 2025,
}

test('older snapshots: average this season only, from the row log', () => {
  assert.deepEqual(nflSeasonAverage(pierce), { average: -2, games: 1 })
})

test('a real negative average is kept (lost yards), not clamped', () => {
  assert.equal(nflSeasonAverage(pierce).average < 0, true)
})

test('published currentSeasonAverage wins over the log', () => {
  assert.deepEqual(nflSeasonAverage({ ...pierce, currentSeasonAverage: -2, currentSeasonGames: 1 }), { average: -2, games: 1 })
  assert.deepEqual(nflSeasonAverage({ ...pierce, currentSeasonAverage: 54.3, currentSeasonGames: 6 }), { average: 54.3, games: 6 })
})

test('no current-season game shows nothing, never the line or last season', () => {
  const lastSeasonOnly = { seasonAverage: 41.2, recent: [40, 42], gameSeasons: [2025, 2025], priorSeasonLabel: 2025 }
  assert.equal(nflSeasonAverage(lastSeasonOnly), null)
  assert.equal(nflSeasonAverage({ seasonAverage: 9.5, line: 9.5, recent: [], gameSeasons: [] }), null)
  assert.equal(nflSeasonAverage({ ...pierce, currentSeasonAverage: null, currentSeasonGames: 0 }), null)
})

test('mixed window: two-season mean is not the season mean', () => {
  const row = { seasonAverage: 213.9, recent: [200, 210, 220, 300, 310, 320, 338], gameSeasons: [2025, 2025, 2025, 2026, 2026, 2026, 2026], priorSeasonLabel: 2025 }
  assert.deepEqual(nflSeasonAverage(row), { average: 317, games: 4 })
})

test('misaligned log is not guessed', () => {
  assert.equal(nflSeasonAverage({ recent: [1, 2, 3], gameSeasons: [2026] }), null)
})

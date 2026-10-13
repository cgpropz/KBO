import assert from 'node:assert/strict'
import test from 'node:test'
import {
  ALL_GAMES_LABEL,
  filterRows,
  listGames,
  matchesGame,
  previewRows,
  readGameParam,
  resolveGameId,
  writeGameParam,
} from '../src/gameFilter.js'

const NOW = new Date('2026-10-13T16:00:00Z')

test('that day\'s games are away @ home, one option per matchup', () => {
  const games = listGames([
    { player: 'Kirill Kaprizov', team: 'MIN', opponent: 'VGK', awayTeam: 'MIN', homeTeam: 'VGK', gameDate: '2026-10-13', start_time: '2026-10-14T00:00:00Z' },
    { player: 'Jack Eichel', team: 'VGK', opponent: 'MIN', home: true, gameDate: '2026-10-13', start_time: '2026-10-14T00:00:00Z' },
    { player: 'Connor McDavid', team: 'EDM', opponent: 'CGY', awayTeam: 'EDM', homeTeam: 'CGY', gameDate: '2026-10-14', start_time: '2026-10-14T02:00:00Z' },
    { player: 'Auston Matthews', team: 'TOR', opponent: 'BOS', awayTeam: 'BOS', homeTeam: 'TOR', gameday: '2026-10-13', gametime: '19:00' },
  ], NOW)
  assert.deepEqual(games.map((game) => game.label), ['BOS @ TOR', 'MIN @ VGK'])
  assert.equal(games.filter((game) => game.id === 'MIN-VGK').length, 1)
  assert.equal(ALL_GAMES_LABEL, 'All games')
})

test('a later slate is listed when nothing is today', () => {
  const games = listGames([
    { team: 'MIN', opponent: 'VGK', awayTeam: 'MIN', homeTeam: 'VGK', gameday: '2026-10-14', gametime: '19:30' },
    { team: 'BOS', opponent: 'NYR', awayTeam: 'NYR', homeTeam: 'BOS', gameday: '2026-10-14', gametime: '19:00' },
  ], NOW)
  assert.deepEqual(games.map((game) => game.label), ['NYR @ BOS', 'MIN @ VGK'])
})

test('home, away, and versus text agree on the label', () => {
  assert.equal(listGames([{ team: 'VGK', opponent: 'MIN', home: true }])[0].label, 'MIN @ VGK')
  assert.equal(listGames([{ team: 'MIN', opponent: 'VGK', home: false }])[0].id, 'MIN-VGK')
  assert.equal(listGames([{ team: 'LVA', opponent: 'NYL', versus: 'LVA @ NYL' }])[0].label, 'LVA @ NYL')
  assert.equal(listGames([{ team: 'NYL', opponent: 'LVA', versus: 'NYL vs LVA' }])[0].id, 'LVA-NYL')
  assert.equal(listGames([{ team: 'JAC', opponent: 'PHI', awayTeam: 'PHI', homeTeam: 'JAX' }])[0].label, 'PHI @ JAX')
})

test('without a home side the label is alphabetical and still one game', () => {
  const games = listGames([
    { team: 'VGK', opponent: 'MIN' },
    { team: 'MIN', opponent: 'VGK' },
    { card: { team: 'Kia', opponent: 'LG' }, prop: { stat: 'Hits' } },
  ])
  assert.deepEqual(games.map((game) => game.label), ['KIA @ LG', 'MIN @ VGK'])
})

test('a selected game keeps both teams on the board, the cards, and the free top 3', () => {
  const rows = [
    { player: 'Kaprizov', team: 'MIN', opponent: 'VGK', awayTeam: 'MIN', homeTeam: 'VGK', score: 90 },
    { player: 'McDavid', team: 'EDM', opponent: 'CGY', awayTeam: 'EDM', homeTeam: 'CGY', score: 80 },
    { player: 'Matthews', team: 'TOR', opponent: 'BOS', awayTeam: 'BOS', homeTeam: 'TOR', score: 70 },
    { player: 'Eichel', team: 'VGK', opponent: 'MIN', home: true, score: 60 },
    { player: 'Eriksson Ek', team: 'MIN', opponent: 'VGK', versus: 'MIN @ VGK', score: 55 },
    { player: 'Boldy', team: 'MIN', opponent: 'VGK', awayTeam: 'MIN', homeTeam: 'VGK', score: 50 },
  ]
  assert.deepEqual(filterRows(rows, 'MIN-VGK').map((row) => row.player), ['Kaprizov', 'Eichel', 'Eriksson Ek', 'Boldy'])
  assert.deepEqual(previewRows(rows, 'MIN-VGK').map((row) => row.player), ['Kaprizov', 'Eichel', 'Eriksson Ek'])
  assert.deepEqual(previewRows(rows, '').map((row) => row.player), ['Kaprizov', 'McDavid', 'Matthews'])
  assert.equal(filterRows(rows, '').length, rows.length)

  const card = {
    name: 'A\'ja Wilson',
    team: 'LVA',
    ppAllProps: [{ stat: 'Points', opponent: 'NYL', versus: 'LVA @ NYL', gameDate: '2026-10-13' }],
  }
  const other = {
    name: 'Breanna Stewart',
    team: 'NYL',
    ppAllProps: [{ stat: 'Points', opponent: 'LVA', versus: 'LVA @ NYL', gameDate: '2026-10-13' }],
  }
  assert.equal(matchesGame(card, 'LVA-NYL'), true)
  assert.equal(matchesGame(other, 'LVA-NYL'), true)
  assert.deepEqual(listGames([card, other], NOW).map((game) => game.id), ['LVA-NYL'])
  assert.deepEqual(filterRows([card, other], 'LVA-NYL').map((player) => player.name), ['A\'ja Wilson', 'Breanna Stewart'])
})

test('unknown, empty, and all-games values do not filter', () => {
  const games = listGames([{ team: 'MIN', opponent: 'VGK', awayTeam: 'MIN', homeTeam: 'VGK' }])
  assert.equal(resolveGameId('MIN-VGK', games), 'MIN-VGK')
  assert.equal(resolveGameId('min-vgk', games), 'MIN-VGK')
  assert.equal(resolveGameId('NO-GAME', games), '')
  assert.equal(resolveGameId('All games', games), '')
  assert.equal(resolveGameId('all', games), '')
  assert.equal(resolveGameId('', games), '')
  assert.deepEqual(previewRows([
    { player: 'A', team: 'MIN', opponent: 'VGK', awayTeam: 'MIN', homeTeam: 'VGK' },
    { player: 'B', team: 'EDM', opponent: 'CGY', awayTeam: 'EDM', homeTeam: 'CGY' },
  ], 'NOT-A-GAME').map((row) => row.player), ['A', 'B'])
})

test('the share link is ?game=AWAY-HOME and other query params stay', () => {
  assert.equal(readGameParam('?sport=nhl&game=MIN-VGK'), 'MIN-VGK')
  assert.equal(readGameParam(''), '')
  const loc = {
    location: {
      href: 'https://cgpropz.com/?sport=nhl',
      pathname: '/',
      search: '?sport=nhl',
      hash: '',
    },
    history: {
      state: { view: 'dashboard' },
      replaceState(state, _title, next) {
        this.state = state
        this.next = next
      },
    },
    events: 0,
    dispatchEvent() { this.events += 1 },
  }
  writeGameParam('MIN-VGK', loc)
  assert.equal(loc.history.next, '/?sport=nhl&game=MIN-VGK')
  assert.deepEqual(loc.history.state, { view: 'dashboard' })
  assert.equal(loc.events, 1)
  loc.location.href = 'https://cgpropz.com/?sport=nhl&game=MIN-VGK'
  loc.location.search = '?sport=nhl&game=MIN-VGK'
  writeGameParam('', loc)
  assert.equal(loc.history.next, '/?sport=nhl')
})

test('empty or one-sided rows do not invent a game', () => {
  assert.deepEqual(listGames(null), [])
  assert.deepEqual(listGames([{ team: 'MIN' }, { opponent: 'VGK' }, { team: 'MIN', opponent: 'MIN' }]), [])
  assert.equal(matchesGame({ team: 'MIN' }, 'MIN-VGK'), false)
  assert.equal(matchesGame({ team: 'MIN', opponent: 'VGK' }, ''), true)
  assert.deepEqual(filterRows(null, 'MIN-VGK'), [])
})

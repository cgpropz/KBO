import assert from 'node:assert/strict'
import test from 'node:test'
import { hubGames, nbaHubRows, statusChips, topHitRateRows, wnbaHubRows } from '../src/memberHub.js'
import { nbaEdgeCards, nbaEdgeMatchups, nbaEdgePlayers, nbaEdgePropTypes, nbaEdgeSlateDate } from '../src/nba/nbaEdgeBoard.js'
import { groupProps } from '../src/nba/nbaPlayerChartProps.js'
import { hasPostedProjection } from '../src/nba/nbaPostedProjection.js'
import { todayPick } from '../src/nba/nbaTodayPick.js'

// Synthetic rows only. A Dunks prop with no projection is pending. It must
// leave the Edge prop tabs, the cards (and the chips those cards render),
// the hub rows, and the player-chart stat chips. A posted number stays.

const LOG = Array.from({ length: 12 }, () => 12)

function braun(props) {
  return {
    name: 'Christian Braun',
    team: 'DEN',
    position: 'SG',
    athleteId: 'braun',
    avgMins: 28,
    matched: true,
    projectionStatus: 'pending',
    gp: 40,
    ppAllProps: props,
  }
}

const pendingDunk = {
  stat: 'Dunks',
  line: 0.5,
  projection: null,
  projectionStatus: 'pending',
  rating: null,
  opponent: 'LAL',
  gameDate: '2026-10-24',
  odds_type: 'standard',
  hitRates: { L10: 80 },
  l10Values: LOG,
}

const postedPoints = {
  stat: 'Points',
  line: 12.5,
  projection: 15.2,
  projectionStatus: 'projected',
  rating: 61,
  opponent: 'LAL',
  gameDate: '2026-10-24',
  odds_type: 'standard',
  hitRates: { L10: 60 },
}

test('hasPostedProjection rejects null, blank, and non-numeric values', () => {
  for (const value of [null, undefined, '', '   ', 'n/a', 'pending', NaN, Infinity]) {
    assert.equal(hasPostedProjection(value), false, String(value))
  }
  for (const value of [0, 0.5, 1.1, '1.1', '0']) {
    assert.equal(hasPostedProjection(value), true, String(value))
  }
})

test('Edge tabs, cards, and matchups omit a pending Dunks prop', () => {
  const onlyPending = [braun([pendingDunk])]
  assert.deepEqual(nbaEdgePropTypes(onlyPending), ['All'])
  assert.equal(nbaEdgeSlateDate(onlyPending), null)
  assert.deepEqual(nbaEdgeMatchups(onlyPending, null), [])
  assert.equal(nbaEdgePlayers(onlyPending).length, 0)
  assert.deepEqual(nbaEdgeCards(nbaEdgePlayers(onlyPending)), [])

  const mixed = [braun([pendingDunk, postedPoints, {
    stat: 'Rebounds',
    line: 4.5,
    projection: '',
    opponent: 'LAL',
    gameDate: '2026-10-24',
    odds_type: 'standard',
  }, {
    stat: 'Assists',
    line: 2.5,
    projection: 'n/a',
    opponent: 'LAL',
    gameDate: '2026-10-24',
    odds_type: 'standard',
  }])]
  assert.deepEqual(nbaEdgePropTypes(mixed), ['All', 'Points'])
  assert.equal(nbaEdgeSlateDate(mixed), '2026-10-24')
  assert.deepEqual(nbaEdgeMatchups(mixed, '2026-10-24').map((game) => game.label), ['DEN vs LAL'])
  const cards = nbaEdgeCards(nbaEdgePlayers(mixed))
  assert.deepEqual(cards.map((card) => card.stat), ['Points'])
  assert.equal(cards[0].projection, 15.2)
  assert.equal(cards[0].player.name, 'Christian Braun')

  const postedDunk = { ...pendingDunk, projection: 1.1, projectionStatus: 'pending', rating: 70 }
  const withNumber = [braun([postedDunk, postedPoints])]
  assert.deepEqual(nbaEdgePropTypes(withNumber), ['All', 'Dunks', 'Points'])
  const kept = nbaEdgeCards(nbaEdgePlayers(withNumber))
  assert.deepEqual(kept.map((card) => `${card.stat}|${card.projection}`).sort(), ['Dunks|1.1', 'Points|15.2'])
})

test('a zero projection still makes an Edge card', () => {
  const players = [braun([{ ...postedPoints, projection: 0, rating: 40 }])]
  const cards = nbaEdgeCards(nbaEdgePlayers(players))
  assert.equal(cards.length, 1)
  assert.equal(cards[0].projection, 0)
})

test('hub rows, hit leaders, and status chips ignore a pending Dunks prop', () => {
  const pendingOnly = nbaHubRows([braun([pendingDunk])])
  assert.equal(pendingOnly.length, 0)
  assert.deepEqual(hubGames('nba', pendingOnly, []), [])
  const waiting = statusChips({ sport: 'nba', rows: pendingOnly, lineups: [], recap: null, ready: true })
  assert.equal(waiting[0].text, 'Lines pending')

  const rows = nbaHubRows([braun([pendingDunk, postedPoints])])
  assert.deepEqual(rows.map((row) => row.stat), ['Points'])
  assert.equal(rows[0].projection, 15.2)
  const leaders = topHitRateRows(rows, 10, new Date('2026-10-21T01:00:00Z'))
  assert.equal(leaders.some((row) => row.stat === 'Dunks'), false)
  const chips = statusChips({ sport: 'nba', rows, lineups: [], recap: null, ready: true })
  assert.equal(chips.some((chip) => chip.text === 'Lines pending'), false)
})

test('WNBA hub rows still keep a blank projection', () => {
  const rows = wnbaHubRows([{
    name: 'A',
    team: 'ATL',
    ppAllProps: [{ stat: 'Points', line: 10.5, projection: null, odds_type: 'standard' }],
  }])
  assert.equal(rows.length, 1)
  assert.equal(rows[0].side, null)
})

test('player chart keeps a logged line with no projection so the profile shows Pending', () => {
  const logs = [
    { pts: 22, reb: 6, date: '2026-10-20' },
    { pts: 18, reb: 4, date: '2026-10-18' },
  ]
  const groups = groupProps(
    { name: 'Synth Rookie', gameLogs: logs },
    {
      ppAllProps: [
        pendingDunk,
        { stat: 'Points', line: 11.5, projection: '', projectionStatus: 'pending' },
        { stat: 'Rebounds', line: 4.5, projection: 6.2 },
      ],
    },
  )
  assert.deepEqual(groups.map((group) => group.stat), ['Points', 'Rebounds'])
  const points = groups.find((group) => group.stat === 'Points')
  assert.equal(points.posted, 11.5)
  assert.deepEqual(todayPick(points.rows[0], points.posted, 'Points'), { projection: null, cg: null, side: null })
  // Dunks is not on the game log, so it was never a chart chip.
  assert.equal(groups.some((group) => group.stat === 'Dunks'), false)
  // The same blank Points row still does not take an Edge tab or card.
  const pendingPoints = { stat: 'Points', line: 11.5, projection: '', opponent: 'DEN' }
  assert.deepEqual(nbaEdgePropTypes([braun([pendingDunk, pendingPoints])]), ['All'])
  assert.equal(nbaEdgeCards(nbaEdgePlayers([braun([pendingPoints])])).length, 0)
})

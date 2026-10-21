import assert from 'node:assert/strict'
import test from 'node:test'
import { gameAlreadyStarted as serverStarted, nbaHighRisk as serverHighRisk } from '../api/_dataAccess.js'
import { gameAlreadyStarted } from '../src/gameStarted.js'
import { EXCLUDED_PROP_LABELS } from '../src/nba/nbaPropLines.js'
import { nbaHighRisk } from '../src/nba/nbaRisk.js'
import { EXCLUDED_PROP_LABELS as WNBA_EXCLUDED_PROP_LABELS } from '../src/wnba/excludedProps.js'
import {
  hitRateBlockReason,
  kboHubRows,
  nbaHubRows,
  nflHubRows,
  nhlHubRows,
  sideLetter,
  topHitRateRows,
  topHubRows,
  wnbaHubRows,
} from '../src/memberHub.js'

// 9:00 PM ET on Oct 20, 2026. Synthetic lines only.
const NOW = new Date('2026-10-21T01:00:00Z')
const LATER = '2026-10-21T02:00:00Z'
const EARLIER = '2026-10-20T23:00:00Z'
const LOG = Array.from({ length: 12 }, () => 12)

function widgetLabel(row) {
  const line = Number(row.line)
  const shown = Number.isInteger(line) ? String(line) : line.toFixed(1)
  const letter = sideLetter(row.side)
  return `${letter}${letter ? ' ' : ''}${shown} ${row.stat}`
}

function nbaPlayer(name, prop = {}, extra = {}) {
  return {
    name,
    team: 'SAS',
    matched: true,
    projectionStatus: 'projected',
    gp: 60,
    avgMins: 28,
    espnInjuryChecked: true,
    espnInjuryStatus: null,
    ...extra,
    ppAllProps: [{
      stat: 'Points',
      line: 8,
      standardLine: 8,
      projection: 11,
      rating: 70,
      odds_type: 'standard',
      start_time: LATER,
      l10Values: LOG,
      ...prop,
    }],
  }
}

test('the server and the hub share one high-risk screen and one started-game check', () => {
  assert.equal(serverHighRisk, nbaHighRisk)
  assert.equal(serverStarted, gameAlreadyStarted)
})

test('NBA hit-rate list drops a high-risk player, a started game, and an excluded prop', () => {
  const rows = nbaHubRows([
    nbaPlayer('Safe Jones'),
    nbaPlayer('Risky Keldon', {}, { avgMins: 12 }),
    nbaPlayer('Tagged Keldon', {}, { espnInjuryStatus: 'Questionable' }),
    nbaPlayer('Short Keldon', {}, { gp: 4 }),
    nbaPlayer('Unmatched Keldon', {}, { matched: false }),
    nbaPlayer('Started Player', { start_time: EARLIER }),
    nbaPlayer('Label Player', { stat: 'Points - 1st 3 Minutes', rating: 90 }),
  ])
  const byName = Object.fromEntries(rows.map((row) => [row.player, row]))
  // A trimmed free preview has none of the screen fields. The server already
  // applied the screen, so the widget does not fail closed a second time.
  const preview = nbaHubRows([{
    name: 'Preview Safe',
    team: 'SAS',
    ppAllProps: nbaPlayer('Preview Safe').ppAllProps,
  }])
  const leaders = topHitRateRows([...rows, ...preview], 10, NOW)
  assert.deepEqual(leaders.map((row) => row.player), ['Preview Safe', 'Safe Jones'])
  assert.equal(hitRateBlockReason(byName['Risky Keldon'], NOW), 'high-risk')
  assert.equal(hitRateBlockReason(byName['Tagged Keldon'], NOW), 'high-risk')
  assert.equal(hitRateBlockReason(byName['Short Keldon'], NOW), 'high-risk')
  assert.equal(hitRateBlockReason(byName['Unmatched Keldon'], NOW), 'high-risk')
  assert.equal(hitRateBlockReason(byName['Started Player'], NOW), 'started')
  assert.equal(hitRateBlockReason(byName['Label Player'], NOW), 'excluded-prop')
  assert.equal(hitRateBlockReason(preview[0], NOW), null)

  const ranked = topHubRows(rows, 8).map((row) => row.player)
  for (const name of ['Risky Keldon', 'Tagged Keldon', 'Started Player', 'Label Player', 'Safe Jones']) {
    assert.equal(ranked.includes(name), true, `${name} stays in the CG list`)
  }
  assert.equal(byName['Label Player'].score, 90)
  assert.equal(byName['Risky Keldon'].score, 70)
})

test('Keldon Johnson O 8 Points is not the excluded prop label', () => {
  const points = nbaHubRows([nbaPlayer('Keldon Johnson')])[0]
  const pts = nbaHubRows([nbaPlayer('Keldon Johnson', { stat: 'Pts' })])[0]
  const labeled = nbaHubRows([nbaPlayer('Keldon Johnson', { stat: 'Points - 1st 3 Minutes' })])[0]
  const risky = nbaHubRows([nbaPlayer('Keldon Johnson', {}, { avgMins: 12 })])[0]
  const started = nbaHubRows([nbaPlayer('Keldon Johnson', { start_time: EARLIER })])[0]

  assert.equal(widgetLabel(points), 'O 8 Points')
  assert.equal(widgetLabel(pts), 'O 8 Pts')
  assert.equal(widgetLabel(labeled), 'O 8 Points - 1st 3 Minutes')
  assert.equal(EXCLUDED_PROP_LABELS.has('Points'), false)
  assert.equal(EXCLUDED_PROP_LABELS.has('Pts'), false)
  assert.equal(EXCLUDED_PROP_LABELS.has('Points - 1st 3 Minutes'), true)

  assert.equal(hitRateBlockReason(points, NOW), null)
  assert.equal(hitRateBlockReason(pts, NOW), null)
  assert.equal(topHitRateRows([points, pts], 10, NOW).length, 2)

  assert.equal(hitRateBlockReason(labeled, NOW), 'excluded-prop')
  assert.equal(hitRateBlockReason(risky, NOW), 'high-risk')
  assert.equal(hitRateBlockReason(started, NOW), 'started')
  assert.equal(topHitRateRows([labeled, risky, started], 10, NOW).length, 0)
  assert.equal(topHubRows([risky], 3)[0].player, 'Keldon Johnson')
})

test('WNBA hit-rate list uses the WNBA prop label and the shared started-game check', () => {
  const rows = wnbaHubRows([
    {
      name: 'Safe Wing',
      team: 'ATL',
      avgMins: 8,
      gp: 3,
      matched: false,
      ppAllProps: [{ stat: 'Points', line: 8, projection: 12, odds_type: 'standard', start_time: LATER, l10Values: LOG }],
    },
    {
      name: 'Early Wing',
      team: 'ATL',
      ppAllProps: [{ stat: 'Points', line: 8, projection: 12, odds_type: 'standard', start_time: EARLIER, l10Values: LOG }],
    },
    {
      name: 'First Three',
      team: 'ATL',
      ppAllProps: [{ stat: 'Points - 1st 3 Minutes', line: 8, projection: 12, odds_type: 'standard', start_time: LATER, l10Values: LOG }],
    },
  ])
  assert.equal(WNBA_EXCLUDED_PROP_LABELS.has('Points - 1st 3 Minutes'), true)
  assert.equal(hitRateBlockReason(rows.find((row) => row.player === 'Safe Wing'), NOW), null)
  assert.equal(hitRateBlockReason(rows.find((row) => row.player === 'Early Wing'), NOW), 'started')
  assert.equal(hitRateBlockReason(rows.find((row) => row.player === 'First Three'), NOW), 'excluded-prop')
  assert.deepEqual(topHitRateRows(rows, 10, NOW).map((row) => row.player), ['Safe Wing'])
  assert.equal(topHubRows(rows, 5).some((row) => row.player === 'First Three'), true)
})

test('NFL hit-rate list drops a started game and a yardage line the board rejects', () => {
  const rows = nflHubRows([
    {
      player: 'Safe Receiver', team: 'BUF', opponent: 'MIA', prop: 'Receiving Yards',
      line: 15.5, projection: 26, line_type: 'standard', start_time: LATER,
      recent: Array.from({ length: 12 }, () => 30), gp: 2, avgMins: 5,
    },
    {
      player: 'Kickoff Receiver', team: 'BUF', opponent: 'MIA', prop: 'Receiving Yards',
      line: 15.5, projection: 26, line_type: 'standard', start_time: EARLIER,
      recent: Array.from({ length: 12 }, () => 30),
    },
    {
      player: 'Any Yards', team: 'BUF', opponent: 'MIA', prop: 'Receiving Yards',
      line: 0.5, projection: 10, line_type: 'standard', start_time: LATER,
      recent: Array.from({ length: 12 }, () => 4),
    },
  ])
  assert.equal(hitRateBlockReason(rows.find((row) => row.player === 'Safe Receiver'), NOW), null)
  assert.equal(hitRateBlockReason(rows.find((row) => row.player === 'Kickoff Receiver'), NOW), 'started')
  assert.equal(hitRateBlockReason(rows.find((row) => row.player === 'Any Yards'), NOW), 'excluded-prop')
  assert.deepEqual(topHitRateRows(rows, 10, NOW).map((row) => row.player), ['Safe Receiver'])
  assert.equal(topHubRows(rows, 5).some((row) => row.player === 'Kickoff Receiver'), true)
})

test('NHL hit-rate list drops a started game and a points over the board drops', () => {
  const live = nhlHubRows([{
    player: 'Safe Skater', team: 'COL', opponent: 'DAL', prop: 'Shots On Goal',
    line: 2.5, projection: 3.4, oddsType: 'standard', rankEligible: true, start_time: LATER,
    recent: Array.from({ length: 12 }, () => 4),
  }])
  const started = nhlHubRows([{
    player: 'Early Skater', team: 'COL', opponent: 'DAL', prop: 'Shots On Goal',
    line: 2.5, projection: 3.4, oddsType: 'standard', rankEligible: true, start_time: EARLIER,
    recent: Array.from({ length: 12 }, () => 4),
  }])
  const droppedByBoard = nhlHubRows([{
    player: 'Low Over', prop: 'Points', line: 0.5, projection: 0.68, oddsType: 'standard',
    rankEligible: true, start_time: LATER, recent: Array.from({ length: 12 }, () => 1),
  }])
  assert.equal(droppedByBoard.length, 0)
  const manualLow = {
    sport: 'nhl',
    player: 'Low Over',
    stat: 'Points',
    line: 0.5,
    projection: 0.68,
    side: 'OVER',
    score: 60,
    recent: Array.from({ length: 10 }, () => 1),
    hitRate: 100,
    hitHits: 10,
    hitGames: 10,
  }
  const rows = [...live, ...started, manualLow]
  assert.equal(hitRateBlockReason(live[0], NOW), null)
  assert.equal(hitRateBlockReason(started[0], NOW), 'started')
  assert.equal(hitRateBlockReason(manualLow, NOW), 'excluded-prop')
  assert.deepEqual(topHitRateRows(rows, 10, NOW).map((row) => row.player), ['Safe Skater'])
  assert.equal(topHubRows(started, 3)[0].player, 'Early Skater')
})

test('KBO hit-rate list drops a started game and a line the board will not score', () => {
  const live = kboHubRows({
    cards: [{
      name: 'Safe Bat', team: 'LG', opponent: 'KT', start_time: LATER,
      props: [{ stat: 'Hits', line: 1.5, odds_type: 'standard', projection: 1.8, recent_values: Array.from({ length: 12 }, () => 2) }],
    }],
  })
  const started = kboHubRows({
    cards: [{
      name: 'Early Bat', team: 'LG', opponent: 'KT', start_time: EARLIER,
      props: [{ stat: 'Hits', line: 1.5, odds_type: 'standard', projection: 1.8, recent_values: Array.from({ length: 12 }, () => 2) }],
    }],
  })
  const yardage = kboHubRows({
    cards: [{
      name: 'Yard Bat', team: 'LG', opponent: 'KT', start_time: LATER,
      props: [{ stat: 'Receiving Yards', line: 0.5, odds_type: 'standard', projection: 8, recent_values: Array.from({ length: 12 }, () => 4) }],
    }],
  })
  assert.equal(yardage.length, 0)
  const manualYardage = {
    sport: 'kbo',
    player: 'Yard Bat',
    stat: 'Receiving Yards',
    line: 0.5,
    projection: 8,
    side: 'OVER',
    score: 70,
    recent: Array.from({ length: 10 }, () => 4),
    hitRate: 100,
    hitHits: 10,
    hitGames: 10,
  }
  assert.equal(hitRateBlockReason(live[0], NOW), null)
  assert.equal(hitRateBlockReason(started[0], NOW), 'started')
  assert.equal(hitRateBlockReason(manualYardage, NOW), 'excluded-prop')
  assert.deepEqual(topHitRateRows([...live, ...started, manualYardage], 10, NOW).map((row) => row.player), ['Safe Bat'])
  assert.equal(topHubRows(started, 3)[0].player, 'Early Bat')
})

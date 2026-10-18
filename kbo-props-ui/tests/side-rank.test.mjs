import test from 'node:test'
import assert from 'node:assert/strict'
import {
  compareSymmetric, displayScore, displayScoreText, rankBlock, rankable, setSymmetricRankViewer,
  sideStrength, symmetricRankAllowed, symmetricRankOn, underOffered, underQualifies,
} from '../src/sideRank.js'
import { NBA_OWNER_EMAIL } from '../src/entitlements.js'
import { selectFreeTop3 } from '../src/freeTopPicks.js'
import { nflHubRows, topHubRows } from '../src/memberHub.js'
import { buildCgScoreExplainer } from '../src/cgScoreExplainer.js'
import { DATASETS } from '../api/_dataAccess.js'

const row = (over) => ({ player: 'P', stat: 'Rush Attempts', line: 10, projection: 5, score: 25, gamesPlayed: 8, line_type: 'standard', ...over })

test('flag is NFL only and admin email only', () => {
  assert.equal(symmetricRankAllowed('nfl', NBA_OWNER_EMAIL, ''), true)
  assert.equal(symmetricRankAllowed('nfl', ` ${NBA_OWNER_EMAIL.toUpperCase()} `, ''), true)
  assert.equal(symmetricRankAllowed('nfl', NBA_OWNER_EMAIL, '?unders=0'), false)
  assert.equal(symmetricRankAllowed('nfl', 'member@example.com', ''), false)
  assert.equal(symmetricRankAllowed('nfl', '', ''), false)
  for (const sport of ['nhl', 'kbo', 'wnba', 'nba']) assert.equal(symmetricRankAllowed(sport, NBA_OWNER_EMAIL, ''), false)
  // Default viewer is nobody, so every caller is off unless the admin signs in.
  setSymmetricRankViewer('')
  assert.equal(symmetricRankOn('nfl'), false)
  setSymmetricRankViewer(NBA_OWNER_EMAIL)
  assert.equal(symmetricRankOn('nfl'), true)
  assert.equal(symmetricRankOn('nhl'), false)
  setSymmetricRankViewer('')
})

test('strength mirrors around 50 and display flips only unders', () => {
  assert.equal(sideStrength(30, 'UNDER'), 70)
  assert.equal(sideStrength(70, 'OVER'), 70)
  assert.equal(sideStrength(30), 70)
  assert.equal(sideStrength(50), -Infinity)
  assert.equal(displayScore(28, 'UNDER'), 72)
  assert.equal(displayScore(72, 'OVER'), 72)
  assert.equal(displayScoreText(28.4, 'UNDER'), '71.6')
})

test('an under at 30 ranks level with an over at 70, ahead of a 60 over', () => {
  const rows = [
    row({ player: 'Over60', score: 60, projection: 12 }),
    row({ player: 'Under25', score: 25, projection: 5 }),
    row({ player: 'Over70', score: 70, projection: 14 }),
  ]
  const order = [...rows].sort((a, b) => compareSymmetric(a, b)).map((r) => r.player)
  assert.deepEqual(order, ['Under25', 'Over70', 'Over60'])
})

test('rank blocks: projection 0 or less, under under 5 games, over-only or non-standard under', () => {
  assert.equal(rankBlock(row({ projection: 0, score: 0 })), 'projection')
  assert.equal(rankBlock(row({ projection: 0, score: 0, side: 'UNDER' })), 'projection')
  assert.equal(rankBlock(row({ projection: -1, score: 80, side: 'OVER' })), 'projection')
  assert.equal(rankBlock(row({ gamesPlayed: 4 })), 'games')
  assert.equal(rankBlock(row({ gamesPlayed: 5 })), null)
  assert.equal(rankBlock(row({ wagerTypes: 'over' })), 'not_offered')
  assert.equal(rankBlock(row({ line_type: 'demon' })), 'not_offered')
  assert.equal(rankBlock(row({ score: 50 })), 'neutral')
  // Overs are not held to the 5-game minimum.
  assert.equal(rankBlock(row({ score: 70, projection: 14, gamesPlayed: 2 })), null)
  assert.equal(underOffered({ allowed_wager_types: 'under_or_over' }), true)
  assert.equal(underOffered({ allowed_wager_types: 'over' }), false)
  assert.equal(underOffered({}), true)
})

test('blocked rows sort after every rankable row', () => {
  const rows = [
    row({ player: 'Zero', projection: 0, score: 0 }),
    row({ player: 'Rookie', score: 10, projection: 2, gamesPlayed: 2 }),
    row({ player: 'Over55', score: 55, projection: 11 }),
  ]
  assert.deepEqual([...rows].sort((a, b) => compareSymmetric(a, b)).map((r) => r.player), ['Over55', 'Zero', 'Rookie'])
})

test('under qualifying rule: standard under, raw score 30 or lower, 5+ games', () => {
  assert.equal(underQualifies(row({ score: 30 })), true)
  assert.equal(underQualifies(row({ score: 30.1 })), false)
  assert.equal(underQualifies(row({ score: 20, gamesPlayed: 4 })), false)
  assert.equal(underQualifies(row({ score: 20, wagerTypes: 'over' })), false)
  assert.equal(underQualifies(row({ score: 0, projection: 0 })), false)
  assert.equal(underQualifies(row({ score: 75, projection: 15 })), false)
})

const nflBoard = [
  { player: 'A Over', team: 'KC', prop: 'Receptions', line: 4.5, projection: 6.3, gamesPlayed: 9, line_type: 'standard' },
  { player: 'B Under', team: 'LV', prop: 'Rush Attempts', line: 9.5, projection: 4.2, gamesPlayed: 8, line_type: 'standard' },
  { player: 'C Zero', team: 'GB', prop: 'Pass TDs', line: 0.5, projection: 0, gamesPlayed: 7, line_type: 'standard' },
  { player: 'D Rookie', team: 'LA', prop: 'Receptions', line: 3.5, projection: 0.8, gamesPlayed: 2, line_type: 'standard' },
  { player: 'E Over', team: 'BUF', prop: 'Rec Targets', line: 6.5, projection: 7.9, gamesPlayed: 9, line_type: 'standard' },
]

test('hub top list: unchanged by default, symmetric when asked', () => {
  const rows = nflHubRows(nflBoard)
  assert.deepEqual(topHubRows(rows, 3).map((r) => r.player), ['A Over', 'E Over', 'B Under'])
  assert.deepEqual(topHubRows(rows, 3, { symmetric: true }).map((r) => r.player), ['B Under', 'A Over', 'E Over'])
  assert.ok(!topHubRows(rows, 5, { symmetric: true }).some((r) => r.player === 'C Zero' || r.player === 'D Rookie'))
})

test('free top 3: unchanged by default, symmetric for the NFL pilot only', () => {
  const rows = nflHubRows(nflBoard).map((r) => ({ ...r, rankEligible: true }))
  const now = new Date('2026-10-18T12:00:00Z')
  assert.deepEqual(selectFreeTop3(rows, 'nfl', now).map((r) => r.player), ['A Over', 'E Over', 'B Under'])
  assert.deepEqual(selectFreeTop3(rows, 'nfl', now, { symmetric: true }).map((r) => r.player), ['B Under', 'A Over', 'E Over'])
})

test('server free preview is not changed by the pilot (members keep today\'s order)', () => {
  const res = DATASETS.nfl_projections.free(nflBoard)
  assert.deepEqual(res.data.map((r) => r.player), ['A Over', 'E Over', 'B Under'])
})

test('explainer names the side and flips only with the pilot on', () => {
  const base = { player: 'B Under', projection: 4.2, line: 9.5, stat: 'Rush Attempts', score: 22.1, recentValues: [] }
  assert.equal(buildCgScoreExplainer(base).score, '22.1')
  assert.equal(buildCgScoreExplainer(base).sideLabel, null)
  const on = buildCgScoreExplainer({ ...base, symmetric: true })
  assert.equal(on.score, '77.9')
  assert.equal(on.sideLabel, 'Under')
})

test('a member never gets the pilot even with the query string', () => {
  setSymmetricRankViewer('member@example.com')
  assert.equal(rankable(row()), true)
  assert.equal(symmetricRankOn('nfl'), false)
  setSymmetricRankViewer('')
})

test('board views that reuse gamesPlayed for the L10 pill keep the builder count', () => {
  assert.equal(rankBlock(row({ gamesPlayed: 0, boardGamesPlayed: 6 })), null)
  assert.equal(rankBlock(row({ gamesPlayed: 9, boardGamesPlayed: 3 })), 'games')
})

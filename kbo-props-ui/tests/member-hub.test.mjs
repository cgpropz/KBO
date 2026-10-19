import assert from 'node:assert/strict'
import test from 'node:test'
import { cgScore } from '../src/cgScore.js'
import { confirmedGoalieStarters, formatRecord, hubGames, kboHubRows, nbaHubRows, nhlHubRows, nflHubRows, playableRows, recapLabel, sameMatchup, statusChips, topHitRateRows, topHubRows, unavailableFromLineups, wnbaHubRows } from '../src/memberHub.js'
import { standardRecord } from '../scripts/write-member-recap.mjs'

test('kbo hub prefers a manual player photo over the name lookup', () => {
  const png = 'https://static.prizepicks.com/images/manual/Kim Do-yeong.png'
  const naver = 'https://6ptotvmi5753.edge.naverncp.com/KBO_IMAGE/person/middle/2026/1.jpg'
  const asset = 'https://static.prizepicks.com/images/manual/Baseball-Asset.webp'
  const kim = kboHubRows({ cards: [{
    name: 'Kim Do-yeong',
    image_url: png,
    props: [{ stat: 'Hits', line: 0.5, odds_type: 'standard', cg_projection: 70, projection: 1.2 }],
  }] }, { 'Kim Do-yeong': naver })
  assert.equal(kim[0].image, png)
  assert.equal(kim[0].ppImageUrl, png)
  const generic = kboHubRows({ cards: [{
    name: 'Dong Won Park',
    image_url: asset,
    props: [{ stat: 'Hits', line: 0.5, odds_type: 'standard', cg_projection: 70, projection: 1.2 }],
  }] }, { 'Dong Won Park': naver })
  assert.equal(generic[0].image, naver)
  assert.equal(generic[0].ppImageUrl, asset)
})

test('hub rows keep standard lines only', () => {
  const kbo = kboHubRows({ cards: [{ name: 'A', props: [
    { stat: 'Hits', line: 0.5, odds_type: 'goblin', cg_projection: 90 },
    { stat: 'Hits', line: 1.5, odds_type: 'standard', cg_projection: 70, projection: 1.8, recommendation: 'OVER' },
  ] }] })
  assert.equal(kbo.length, 1)
  // KBO hub rows rank by the CG Score (1.8 vs 1.5), not cg_projection.
  assert.equal(kbo[0].score, 60)
  const nhl = nhlHubRows([{ player: 'B', prop: 'Points', line: 0.5, projection: 1, oddsType: 'demon' }, { player: 'C', prop: 'Points', line: 0.5, projection: 1, oddsType: 'standard' }])
  assert.deepEqual(nhl.map((r) => r.player), ['C'])
  const nfl = nflHubRows([{ player: 'D', prop: 'Receptions', line: 4.5, projection: 6, line_type: 'goblin' }])
  assert.equal(nfl.length, 0)
  const nba = nbaHubRows([{ name: 'E', ppAllProps: [{ stat: 'Points', line: 9.5, standardLine: 9.5, rating: 60, projection: 11 }, { stat: 'Points', line: 7.5, standardLine: 9.5, rating: 80 }] }])
  assert.deepEqual(nba.map((r) => r.score), [60])
})

test('top rows are one per player, best score first', () => {
  const rows = [
    { player: 'A', stat: 's', line: 1, score: 60 },
    { player: 'A', stat: 't', line: 1, score: 90 },
    { player: 'B', stat: 's', line: 1, score: 70 },
    { player: 'C', stat: 's', line: 1, score: NaN },
  ]
  assert.deepEqual(topHubRows(rows).map((r) => [r.player, r.score]), [['A', 90], ['B', 70]])
})

test('held and OUT players stay off the hub, including a Gauthier-style row', () => {
  const rows = [
    { player: 'Cutter Gauthier', stat: 'Points', line: 0.5, score: 88, injury: 'OUT' },
    { player: 'Held Skater', stat: 'Shots On Goal', line: 2.5, score: 91, status: 'held' },
    { player: 'Questionable', stat: 'Points', line: 0.5, score: 60, status: 'GTD' },
    { player: 'Healthy', stat: 'Points', line: 0.5, score: 70 },
  ]
  assert.deepEqual(topHubRows(rows).map((r) => r.player), ['Healthy', 'Questionable'])
  const names = unavailableFromLineups('nhl', [{
    injuries: { ANA: [{ name: 'Cutter Gauthier', status: 'out' }, { name: 'Alex Tuch', status: 'GTD' }] },
    lineups: { ANA: [{ name: 'Cutter Gauthier', status: 'out' }] },
  }])
  const slate = [
    { player: 'Cutter Gauthier', stat: 'Points', line: 0.5, score: 80 },
    { player: 'Alex Tuch', stat: 'Points', line: 0.5, score: 55 },
  ]
  assert.deepEqual(playableRows(slate, names).map((r) => r.player), ['Alex Tuch'])
  const nfl = unavailableFromLineups('nfl', [{
    injuries: { DET: [{ name: 'Amon-Ra St. Brown', status: 'OUT' }, { name: 'Sam LaPorta', status: 'GTD' }] },
  }])
  assert.equal(nfl.has('amon ra st brown'), true)
  assert.equal(nfl.has('sam laporta'), false)
  const wnba = unavailableFromLineups('wnba', [{
    visitor: { players: [{ name: 'Angel Reese', status: 'out' }, { name: 'Allisha Gray', status: 'questionable' }], inactive: [{ name: 'Rhyne Howard' }, { name: 'Maya Caldwell', status: 'gtd' }] },
  }])
  assert.equal(wnba.has('angel reese'), true)
  assert.equal(wnba.has('rhyne howard'), true)
  assert.equal(wnba.has('allisha gray'), false)
  assert.equal(wnba.has('maya caldwell'), false)
})

test('hub rows carry the board hit rate and log without changing the score', () => {
  const kbo = kboHubRows({ cards: [{ name: 'A', team: 'LG', opponent: 'KT', games: [
    { tb: 2, date: '2026-10-12' },
    { tb: 0, date: '2026-10-11' },
  ], props: [{ stat: 'Total Bases', line: 1.5, odds_type: 'standard', cg_projection: 70, projection: 1.8, hit_rate_l10: 60, recent_values: [3, 0, 2] }] }] })
  assert.equal(kbo[0].score, 60)
  assert.equal(kbo[0].hitRate, 60)
  assert.deepEqual(kbo[0].recent, [2, 0, 3])
  const nhl = nhlHubRows([{
    player: 'Alex Ovechkin', prop: 'Points', line: 0.5, projection: 0.9, oddsType: 'standard',
    hitRate: 70, gamesL10: 10, recent: [0, 1, 2], dvpRank: 28, score: 999,
  }])
  assert.equal(nhl[0].score, cgScore(0.9, 0.5, 'Points'))
  assert.equal(nhl[0].hitRate, 70)
  assert.deepEqual(nhl[0].recent, [0, 1, 2])
  assert.equal(nhl[0].oppRank, 28)
  const wnba = wnbaHubRows([{
    name: 'Allisha Gray', team: 'ATL', recentGames: [
      { ftm: 4, date: '10/09/2026' },
      { ftm: 1, date: '10/07/2026' },
    ],
    ppAllProps: [{ stat: 'Free Throws Made', line: 2.5, standardLine: 2.5, projection: 3.2, effectiveDvpFactor: 6 }],
  }])
  assert.equal(wnba[0].oppRank, 6)
  assert.deepEqual(wnba[0].recent, [1, 4])
  assert.equal(wnba[0].hitRate, null)
})

test('NFL L10 uses the chart window, and a missing stored rate is not 0%', () => {
  // Oldest-first, same order the board ships. Ty Johnson O15.5 receiving yards:
  // the last 10 include several overs and one push. Number(null) used to turn
  // the missing stored rate into L10 0% while the bars stayed green.
  const recent = [4, 8, '22', 15.5, 40, 3, 18, 30, 12, 16, 9, 28]
  const rows = nflHubRows([{
    player: 'Ty Johnson', team: 'BUF', opponent: 'LV', prop: 'Receiving Yards',
    line: '15.5', projection: 26.6, line_type: 'standard', recent,
  }])
  assert.equal(rows[0].side, 'OVER')
  assert.equal(rows[0].hitRate, 67)
  assert.equal(rows[0].hitHits, 6)
  assert.equal(rows[0].hitGames, 9)
  assert.notEqual(rows[0].hitRate, 0)

  const under = nflHubRows([{
    player: 'Ty Johnson', prop: 'Receiving Yards', line: 15.5, projection: 10,
    line_type: 'standard', recent,
  }])
  assert.equal(under[0].side, 'UNDER')
  assert.equal(under[0].hitRate, 33)
  assert.equal(under[0].hitHits, 3)

  const short = nflHubRows([{
    player: 'Short Log', prop: 'Receptions', line: 4.5, projection: 5,
    line_type: 'standard', recent: [6, 2, 7],
  }])
  assert.equal(short[0].hitRate, null)
  assert.equal(short[0].hitHits, 2)
  assert.equal(short[0].hitGames, 3)

  // T.J. Hughes SOG 1.5: seven games, four overs, stored L10 57.1%. The log is
  // too short to invent an L10, and the drilldown still shows 4/7.
  const hughes = nhlHubRows([{
    player: 'T.J. Hughes', team: 'COL', opponent: 'PIT', prop: 'Shots On Goal',
    line: 1.5, projection: 1.94, oddsType: 'standard', hitRate: 57.1, gamesL10: 7,
    recent: [1, 0, 2, 3, 1, 4, 2],
  }])
  assert.equal(hughes[0].hitRate, 57.1)
  assert.equal(hughes[0].hitHits, 4)
  assert.equal(hughes[0].hitGames, 7)
  assert.equal(topHitRateRows(hughes).length, 0)

  const pushed = nflHubRows([{
    player: 'All Push', prop: 'Receiving Yards', line: 15.5, projection: 20,
    line_type: 'standard', recent: Array(12).fill(15.5),
  }])
  assert.equal(pushed[0].hitRate, null)

  const leaders = topHitRateRows([...rows, ...under, ...short, ...pushed, rows[0]])
  assert.deepEqual(leaders.map((row) => [row.player, row.side, row.hitRate, `${row.hitHits}/${row.hitGames}`]), [
    ['Ty Johnson', 'OVER', 67, '6/9'],
    ['Ty Johnson', 'UNDER', 33, '3/9'],
  ])
})

test('a confirmed starter stays and the other goalie leaves the preview', () => {
  const lineups = [{
    date: '2026-10-15',
    awayTeam: 'NYI',
    homeTeam: 'OTT',
    goalies: {
      NYI: { name: 'Semyon Varlamov', confirmed: true, status: 'confirmed' },
      OTT: { name: 'Linus Ullmark', confirmed: false, status: 'probable' },
    },
  }]
  const starters = confirmedGoalieStarters(lineups)
  const rows = [
    { player: 'Ilya Sorokin', team: 'NYI', stat: 'Goalie Saves', line: 28.5, score: 70, position: 'G' },
    { player: 'Semyon Varlamov', team: 'NYI', stat: 'Goalie Saves', line: 26.5, score: 62, position: 'G' },
    { player: 'Bo Horvat', team: 'NYI', stat: 'Points', line: 0.5, score: 80 },
    { player: 'Linus Ullmark', team: 'OTT', stat: 'Goalie Saves', line: 22.5, score: 55, position: 'G' },
  ]
  assert.deepEqual(playableRows(rows, new Set(), starters).map((row) => row.player), [
    'Semyon Varlamov', 'Bo Horvat', 'Linus Ullmark',
  ])
  const probable = confirmedGoalieStarters([{
    goalies: { NYI: { name: 'Semyon Varlamov', status: 'probable', confirmed: false } },
  }])
  assert.equal(probable.size, 0)
  assert.deepEqual(playableRows(rows, new Set(), probable).map((row) => row.player), rows.map((row) => row.player))
})

test('status chips and matchups come from the lineup snapshot', () => {
  const chips = statusChips({
    sport: 'nhl',
    rows: [],
    lineups: [{
      awayTeam: 'MTL', homeTeam: 'WSH', start_time: '2026-10-14T23:30:00Z',
      goalies: { MTL: { status: 'confirmed', confirmed: true }, WSH: { status: 'probable' } },
      lineLabels: { MTL: 'PROJECTED', WSH: 'PROJECTED' },
    }],
    recap: { slate_date_iso: '2026-10-12', hits: 2, misses: 1, pushes: 1 },
    now: new Date('2026-10-14T03:30:00Z'),
  })
  assert.deepEqual(chips.map((chip) => chip.text), ['Goalie confirmed', 'Lines projected', 'Yesterday 2-1-1 → Results'])
  const games = hubGames('nhl', [{ team: 'DAL', opponent: 'COL' }], [{ awayTeam: 'MTL', homeTeam: 'WSH' }])
  assert.deepEqual(games.map((game) => game.team), ['MTL', 'DAL'])
  assert.equal(sameMatchup({ team: 'WSH', opponent: 'MTL' }, games[0]), true)
  assert.equal(sameMatchup({ team: 'DAL', opponent: 'COL' }, games[0]), false)
  const pending = statusChips({ sport: 'nfl', rows: [], lineups: [], recap: null, ready: true })
  assert.equal(pending[0].text, 'Lines pending')
})

test('record counts standard graded lines and labels the slate', () => {
  const r = standardRecord({ props: [
    { odds_type: 'standard', model_result: 'HIT' },
    { odds_type: 'standard', model_result: 'MISS' },
    { odds_type: 'standard', model_result: 'PUSH' },
    { odds_type: 'demon', model_result: 'HIT' },
    { odds_type: 'standard', model_result: 'HIT', rank_eligible: false },
    { odds_type: 'standard', model_result: 'N/A' },
  ] })
  assert.deepEqual(r, { hits: 1, misses: 1, pushes: 1 })
  assert.equal(formatRecord(r), '1-1-1')
  const now = new Date('2026-10-14T03:30:00Z')
  assert.equal(recapLabel('2026-10-12', now), 'Yesterday')
  assert.equal(recapLabel('2026-09-27', now), 'Last graded Sep 27')
})

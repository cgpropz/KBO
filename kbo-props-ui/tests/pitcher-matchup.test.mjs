import assert from 'node:assert/strict'
import test from 'node:test'
import {
  buildPitcherMatchup,
  gameDateKey,
  leagueFromRankings,
  nameKey,
  rateTone,
  resolveLeague,
  resolvePitcherRates,
} from '../src/pitcherMatchup.js'

const matchups = [
  {
    away: 'Samsung',
    home: 'Kia',
    game_date: '2026-10-06',
    away_pitcher: { name: 'Jang Chan Hee', profile: { era: 4.3, whip: 1.36 } },
    home_pitcher: { name: 'Kim Tae Hyeong', profile: { era: 5.04, whip: 1.57, total_ip: 75, total_hr: 11 } },
  },
  {
    away: 'Doosan',
    home: 'Lotte',
    game_date: '2026-10-06',
    away_pitcher: { name: 'Gwak Been', profile: { era: 3.8, whip: 1.2 } },
    home_pitcher: { name: 'Park Se Woong', profile: { era: 4.1, whip: 1.3 } },
  },
  {
    away: 'NC',
    home: 'LG',
    game_date: '2026-10-06',
    away_pitcher: { name: null, profile: null },
    home_pitcher: { name: 'Park Si Won', profile: { era: 4.0, whip: 1.5 } },
  },
]

const kimRates = [{
  name: 'Kim Tae Hyeong',
  team: 'Kia',
  era: 5.04,
  whip: 1.57,
  baa: 0.247,
  k_pct: 13.8,
  bb_pct: 9.2,
  h_per_ip: 1.147,
  hr_per_9: 1.32,
  ip: 75,
  starts: 23,
  hand: 'R',
}]

const league = {
  era: 4.34, whip: 1.38, baa: 0.232, k_pct: 19.6, bb_pct: 7.9, h_per_ip: 1.032, hr_per_9: 0.92,
}

test('name keys ignore hyphens and word order', () => {
  assert.equal(nameKey('Kim Tae-hyeong'), nameKey('Tae Hyeong Kim'))
})

test('opposing starter follows the PrizePicks opponent, not the batter team', () => {
  const model = buildPitcherMatchup({
    batterTeam: 'Samsung',
    opponent: 'Kia',
    matchups,
    slateDate: '20261006',
    rankings: [],
    league,
    seasonRates: kimRates,
  })
  assert.equal(model.starterName, 'Kim Tae Hyeong')
  assert.equal(model.team, 'Kia')
  assert.equal(model.handLabel, 'RHP')
  assert.equal(model.stats.find((stat) => stat.key === 'k_pct').tone, 'easy')
  assert.equal(model.stats.find((stat) => stat.key === 'era').tone, 'easy')
  assert.equal(model.stats.find((stat) => stat.key === 'ip').tone, 'neutral')
  assert.equal(model.stats.find((stat) => stat.key === 'baa').display, '.247')
})

test('a PrizePicks opponent from another starter-feed game is not announced', () => {
  const model = buildPitcherMatchup({
    batterTeam: 'Samsung',
    opponent: 'Doosan',
    matchups,
    slateDate: '2026-10-06',
    rankings: [],
    league,
    seasonRates: kimRates,
  })
  assert.equal(model.starterName, null)
  assert.match(model.emptyDetail, /Samsung vs Doosan/)
  assert.doesNotMatch(model.emptyDetail, /Kim Tae Hyeong|Gwak Been/)
})

test('PrizePicks opposing pitcher is used when that pitcher is on the card opponent', () => {
  const model = buildPitcherMatchup({
    batterTeam: 'Samsung',
    opponent: 'Doosan',
    sources: [{ opp_pitcher: 'Gwak Been', opp_pitcher_team: 'Doosan', game_date: '2026-10-06' }],
    matchups,
    slateDate: '2026-10-06',
    rankings: [],
    league,
    seasonRates: [{ name: 'Gwak Been', team: 'Doosan', era: 3.8, whip: 1.2, hand: 'R', starts: 12 }],
  })
  assert.equal(model.starterName, 'Gwak Been')
  assert.equal(model.team, 'Doosan')
})

test('a PrizePicks pitcher from the wrong team is ignored', () => {
  const model = buildPitcherMatchup({
    batterTeam: 'Samsung',
    opponent: 'Doosan',
    sources: [{ opp_pitcher: 'Kim Tae Hyeong', opp_pitcher_team: 'Kia' }],
    matchups,
    slateDate: '2026-10-06',
    rankings: [],
    league,
    seasonRates: kimRates,
  })
  assert.equal(model.starterName, null)
})

test('a starter from another date is not used', () => {
  const model = buildPitcherMatchup({
    batterTeam: 'Samsung',
    opponent: 'Kia',
    sources: [{ gameDate: '2026-10-07' }],
    matchups,
    slateDate: '2026-10-06',
    rankings: [],
    league,
    seasonRates: kimRates,
  })
  assert.equal(model.starterName, null)
  assert.match(model.emptyDetail, /game date/)
})

test('missing starter name is the not-announced state', () => {
  const model = buildPitcherMatchup({
    batterTeam: 'NC',
    opponent: 'LG',
    matchups: matchups.map((game) => (
      game.home === 'LG' ? { ...game, home_pitcher: { name: '', profile: null } } : game
    )),
    rankings: [],
    league,
    seasonRates: [],
  })
  assert.equal(model.starterName, null)
  assert.match(model.emptyDetail, /not been posted/)
})

const TODAY = [
  { away: 'KT', home: 'Kiwoom', game_date: '2026-10-06', away_pitcher: { name: 'Davis Daniel' }, home_pitcher: { name: 'Park Jun Hyun' } },
  { away: 'NC', home: 'LG', game_date: '2026-10-06', away_pitcher: { name: 'Choi Sung Young' }, home_pitcher: { name: 'Park Si Won' } },
  { away: 'Doosan', home: 'Lotte', game_date: '2026-10-06', away_pitcher: { name: 'Gwak Been' }, home_pitcher: { name: 'Park Se Woong' } },
  { away: 'SSG', home: 'Hanwha', game_date: '2026-10-06', away_pitcher: { name: 'Kim Keon Woo' }, home_pitcher: { name: 'Owen White' } },
  { away: 'Samsung', home: 'Kia', game_date: '2026-10-06', away_pitcher: { name: 'Jang Chan Hee' }, home_pitcher: { name: 'Kim Tae Hyeong' } },
]

const starterRates = [
  { name: 'Kim Tae Hyeong', team: 'Kia', era: 5.04, whip: 1.57, starts: 23, hand: 'R' },
  { name: 'Kim Tae Gyeong', team: 'Kia', era: 9.99, whip: 2.5, starts: 4 },
  { name: 'Jang Chan Hee', team: 'Samsung', era: 4.3, whip: 1.36, starts: 39 },
  { name: 'Park Jun Hyun', team: 'Kiwoom', era: 5.55, whip: 1.73, starts: 21 },
  { name: 'Park Jun Young', team: 'Hanwha', era: 6.44, whip: 1.51, starts: 48 },
  { name: 'Owen White', team: 'Hanwha', era: 3.94, whip: 1.28, starts: 24 },
  { name: 'Mitch White', team: 'SSG', era: 4.11, whip: 1.7, starts: 6 },
  { name: 'Davis Daniel', team: 'KT', era: 2.16, whip: 1.18, starts: 9 },
  { name: 'Kim Keon Woo', team: 'SSG', era: 6.03, whip: 1.72, starts: 27 },
  { name: 'Park Se Woong', team: 'Lotte', era: 4.92, whip: 1.54, starts: 25 },
  { name: 'Gwak Been', team: 'Doosan', era: 2.26, whip: 1.06, starts: 26 },
  { name: 'Park Si Won', team: 'LG', era: 4.0, whip: 1.52, starts: 28 },
  { name: 'Choi Sung Young', team: 'NC', era: 1.42, whip: 1.58, starts: 6 },
]

function eraOf(model) {
  return model.stats.find((stat) => stat.key === 'era').display
}

test('today slate uses the opposing starter from the batter card game', () => {
  const expected = {
    Samsung: ['Kim Tae Hyeong', '5.04'],
    Kia: ['Jang Chan Hee', '4.30'],
    NC: ['Park Si Won', '4.00'],
    LG: ['Choi Sung Young', '1.42'],
    Doosan: ['Park Se Woong', '4.92'],
    Lotte: ['Gwak Been', '2.26'],
    SSG: ['Owen White', '3.94'],
    Hanwha: ['Kim Keon Woo', '6.03'],
    KT: ['Park Jun Hyun', '5.55'],
    Kiwoom: ['Davis Daniel', '2.16'],
  }
  for (const [batterTeam, [starter, era]] of Object.entries(expected)) {
    const game = TODAY.find((row) => row.away === batterTeam || row.home === batterTeam)
    const opponent = game.away === batterTeam ? game.home : game.away
    const model = buildPitcherMatchup({
      batterTeam,
      opponent,
      matchups: TODAY,
      slateDate: '2026-10-06',
      rankings: [],
      league,
      seasonRates: starterRates,
    })
    assert.equal(model.starterName, starter, batterTeam)
    assert.equal(model.team, opponent, batterTeam)
    assert.equal(eraOf(model), era, batterTeam)
  }
})

test('name variants load that pitcher and not a lookalike', () => {
  const hyeong = buildPitcherMatchup({
    batterTeam: 'Samsung',
    opponent: 'Kia',
    matchups: [{
      away: 'Samsung',
      home: 'Kia',
      game_date: '2026-10-06',
      away_pitcher: { name: 'Jang Chan-hee' },
      home_pitcher: { name: 'Kim Tae-hyeong' },
    }],
    slateDate: '2026-10-06',
    rankings: [],
    league,
    seasonRates: starterRates,
  })
  assert.equal(hyeong.starterName, 'Kim Tae Hyeong')
  assert.equal(eraOf(hyeong), '5.04')

  const jun = buildPitcherMatchup({
    batterTeam: 'KT',
    opponent: 'Kiwoom',
    sources: [{ opp_pitcher: 'Park Jun-hyun', opp_pitcher_team: 'Kiwoom' }],
    matchups: TODAY,
    slateDate: '2026-10-06',
    rankings: [],
    league,
    seasonRates: starterRates,
  })
  assert.equal(jun.starterName, 'Park Jun Hyun')
  assert.equal(eraOf(jun), '5.55')

  const white = buildPitcherMatchup({
    batterTeam: 'SSG',
    opponent: 'Hanwha',
    sources: [{ opp_pitcher: 'White', opp_pitcher_team: 'Hanwha' }],
    matchups: TODAY,
    slateDate: '2026-10-06',
    rankings: [],
    league,
    seasonRates: starterRates,
  })
  assert.equal(white.starterName, 'Owen White')
  assert.equal(eraOf(white), '3.94')

  const daniel = buildPitcherMatchup({
    batterTeam: 'Kiwoom',
    opponent: 'KT',
    sources: [{ opp_pitcher: 'Daniel', opp_pitcher_team: 'KT' }],
    matchups: TODAY,
    slateDate: '2026-10-06',
    rankings: [],
    league,
    seasonRates: starterRates,
  })
  assert.equal(daniel.starterName, 'Davis Daniel')
  assert.equal(eraOf(daniel), '2.16')
})

test('game dates normalize compact and KST timestamps', () => {
  assert.equal(gameDateKey('20261006'), '2026-10-06')
  assert.equal(gameDateKey('2026-10-05T18:30:00Z'), '2026-10-06')
})

test('neutral band is five percent of the league rate', () => {
  assert.equal(rateTone(4.5, 4.34, 'higher'), 'neutral')
  assert.equal(rateTone(4.6, 4.34, 'higher'), 'easy')
  assert.equal(rateTone(3.9, 4.34, 'higher'), 'tough')
  assert.equal(rateTone(22, 19.6, 'lower'), 'tough')
  assert.equal(rateTone(13.8, 19.6, 'lower'), 'easy')
  assert.equal(rateTone(null, 4.34, 'higher'), 'neutral')
})

test('published league rates win over the rankings fallback', () => {
  const rankings = [{ era: 9, whip: 2, baa: 0.4, k_pct: 40, ip_per_g: 5, gs: 10, ha_per_g: 8 }]
  assert.equal(resolveLeague(league, { era: 1, baa: 0.1 }, rankings).era, 4.34)
  assert.equal(resolveLeague(null, league, rankings).whip, 1.38)
  assert.ok(Math.abs(resolveLeague(null, null, rankings).era - 9) < 0.001)
})

test('rankings fill BAA and K% when the profile only has ERA and WHIP', () => {
  const rates = resolvePitcherRates(
    { era: 5.04, whip: 1.57, total_ip: 75, total_hr: 11 },
    { baa: 0.247, k_pct: 13.8, ha_per_g: 3.7, ip_per_g: 3.3, gs: 23 },
    null,
  )
  assert.equal(rates.baa, 0.247)
  assert.equal(rates.k_pct, 13.8)
  assert.equal(rates.hr_per_9, (11 * 9) / 75)
  assert.ok(rates.bb_pct > 8 && rates.bb_pct < 11)
})

test('a team-WHIP fallback is not treated as the pitcher season line', () => {
  const rates = resolvePitcherRates({ whip: 1.4 }, null, { whip: 1.57, era: 5.04, hand: 'R' })
  assert.equal(rates.whip, 1.57)
  assert.equal(rates.hand, 'R')
})

test('innings-weighted ranking averages use workload, not a flat mean', () => {
  const leagueRates = leagueFromRankings([
    { era: 2, whip: 1, baa: 0.2, k_pct: 30, ip_per_g: 1, gs: 2, ha_per_g: 1 },
    { era: 6, whip: 1.8, baa: 0.3, k_pct: 10, ip_per_g: 6, gs: 20, ha_per_g: 8 },
  ])
  assert.ok(leagueRates.era > 5)
  assert.ok(leagueRates.h_per_ip > 1)
})

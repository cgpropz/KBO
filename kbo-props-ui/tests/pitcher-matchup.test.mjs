import assert from 'node:assert/strict'
import test from 'node:test'
import {
  buildPitcherMatchup,
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
    away_pitcher: { name: 'Jang Chan Hee', profile: { era: 4.3, whip: 1.36 } },
    home_pitcher: { name: 'Kim Tae Hyeong', profile: { era: 5.04, whip: 1.57, total_ip: 75, total_hr: 11 } },
  },
  {
    away: 'NC',
    home: 'LG',
    away_pitcher: { name: null, profile: null },
    home_pitcher: { name: 'Park Si Won', profile: { era: 4.0, whip: 1.5 } },
  },
]

const league = {
  era: 4.34, whip: 1.38, baa: 0.232, k_pct: 19.6, bb_pct: 7.9, h_per_ip: 1.032, hr_per_9: 0.92,
}

test('name keys ignore hyphens and word order', () => {
  assert.equal(nameKey('Kim Tae-hyeong'), nameKey('Tae Hyeong Kim'))
})

test('opposing starter is the pitcher facing the batter team', () => {
  const model = buildPitcherMatchup({
    batterTeam: 'Samsung',
    matchups,
    rankings: [],
    league,
    seasonRates: [{
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
    }],
  })
  assert.equal(model.starterName, 'Kim Tae Hyeong')
  assert.equal(model.team, 'Kia')
  assert.equal(model.stats.find((stat) => stat.key === 'k_pct').tone, 'easy')
  assert.equal(model.stats.find((stat) => stat.key === 'era').tone, 'easy')
  assert.equal(model.stats.find((stat) => stat.key === 'ip').tone, 'neutral')
  assert.equal(model.stats.find((stat) => stat.key === 'baa').display, '.247')
})

test('missing starter name is the not-announced state', () => {
  const model = buildPitcherMatchup({
    batterTeam: 'LG',
    matchups,
    rankings: [],
    league,
    seasonRates: [],
  })
  assert.equal(model.starterName, null)
  assert.match(model.emptyDetail, /not been posted/)
})

test('a team off the slate has no starter', () => {
  const model = buildPitcherMatchup({
    batterTeam: 'Doosan',
    matchups,
    rankings: [],
    league,
    seasonRates: [],
  })
  assert.equal(model.starterName, null)
  assert.match(model.emptyDetail, /not on today's slate/)
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
